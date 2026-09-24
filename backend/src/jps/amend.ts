/**
 * Keep a Pending instruction in step with KLIP.
 *
 * JPS lets a partner amend an instruction only while its status is Pending, and only these fields
 * (partner API v4.2 §4.1.1):
 *
 *   trade_term, surveyor_name, and per cargo line: po_no, so_no, shipper_name
 *
 * `eta` and `etd` are NOT amendable. So a discharge ETA that moves after submission stays wrong at
 * JPS and there is nothing this can do about it - that needs either a new field on their PATCH or a
 * withdraw-and-resubmit endpoint, neither of which exists today.
 *
 * Which of the amendable fields KLIP can actually move:
 *   - `trade_term`, from the contract incoterm. Changes when an STO's contracts stop disagreeing
 *     about it, or when SAP corrects one.
 *   - `po_no` per line, when the STO's contract composition changes between submit and approval.
 *   - `surveyor_name` and `shipper_name` are never sent - KLIP has no surveyor, and JPS rejects a
 *     shipper that is not already in its master.
 *
 * A cargo line is identified by `contract_no`, not `line_order`: line_order depends on the order
 * the submission happened to build, and a line added or dropped since would shift every index after
 * it onto the wrong contract. contract_no cannot drift that way.
 *
 * NEW cargo lines cannot be added - PATCH updates existing rows only. An STO that gains a contract
 * after submission is reported rather than silently half-synced.
 */
import { query } from './../database/connection';
import logger from '../utils/logger';
import { jpsRequest } from './client';
import { jpsPortId, jpsRegionSite } from './config';
import { findEligibleStos } from './eligibility';
import { buildJpsSubmitPayload } from './mapper';
import type { JpsInstruction, JpsSubmitPayload } from './types';

/** Same fixed agent the submission uses; it is not amended, only needed to rebuild the payload. */
const JPS_AGENT_NAME = 'Other';

export interface JpsAmendSummary {
  checked: number;
  amended: number;
  unchanged: number;
  blocked: number;
  failed: number;
}

interface CargoPatch {
  contract_no: string;
  po_no?: string;
}

interface AmendBody {
  trade_term?: string;
  cargo?: CargoPatch[];
}

/**
 * What changed between the payload KLIP sent and the one it would send now, limited to the fields
 * JPS will accept. Returns null when nothing amendable has moved - the common case, and the reason
 * this costs no API calls on a quiet sweep.
 */
export function buildJpsAmendBody(
  sent: JpsSubmitPayload | null | undefined,
  current: JpsSubmitPayload,
): AmendBody | null {
  if (!sent) return null;
  const body: AmendBody = {};

  if ((current.trade_term ?? '') !== (sent.trade_term ?? '')) {
    // Only a real term can be sent. Going from FOB to "no term" is not expressible - JPS has no way
    // to clear one - so a term that has become unmappable is left as it was rather than guessed at.
    if (current.trade_term) body.trade_term = current.trade_term;
  }

  const sentByContract = new Map<string, string>();
  for (const line of sent.cargo ?? []) {
    if (line.contract_no) sentByContract.set(line.contract_no, line.po_no ?? '');
  }
  const cargo: CargoPatch[] = [];
  for (const line of current.cargo ?? []) {
    if (!line.contract_no) continue;
    if (!sentByContract.has(line.contract_no)) continue; // a new line; PATCH cannot add one
    if ((line.po_no ?? '') === sentByContract.get(line.contract_no)) continue;
    if (!line.po_no) continue; // same reason as trade_term: no way to clear a value
    cargo.push({ contract_no: line.contract_no, po_no: line.po_no });
  }
  if (cargo.length > 0) body.cargo = cargo;

  return Object.keys(body).length > 0 ? body : null;
}

/** One amendment pass over everything JPS still lists as Pending. */
export async function amendPendingInstructions(limit = 50): Promise<JpsAmendSummary> {
  const summary: JpsAmendSummary = { checked: 0, amended: 0, unchanged: 0, blocked: 0, failed: 0 };

  const pending = await query(
    `SELECT id, sto_key, revision, jps_id, external_reference, payload
     FROM jps_shipping_instructions
     WHERE state = 'SUBMITTED'
       AND COALESCE(jps_status, 'Pending') = 'Pending'
       AND payload IS NOT NULL
     ORDER BY updated_at
     LIMIT $1`,
    [limit],
  );
  if (pending.rows.length === 0) return summary;

  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of pending.rows as Array<Record<string, unknown>>) {
    byKey.set(String(row.sto_key), row);
  }

  // One query for all of them rather than one each: the source query carries the whole contract and
  // shipment join, and running it per instruction would multiply that by the Pending count.
  const sources = await findEligibleStos(jpsRegionSite(), pending.rows.length, {
    stoKeys: [...byKey.keys()],
  });

  for (const source of sources) {
    const row = byKey.get(source.sto_key);
    if (!row) continue;
    summary.checked += 1;

    const built = buildJpsSubmitPayload(
      { ...source, revision: Number(row.revision ?? 1) },
      { portId: jpsPortId(), agentName: JPS_AGENT_NAME },
    );
    if (!built.payload) {
      // The STO no longer builds a valid payload at all - a product lost its mapping, say. Nothing
      // to amend toward, and the submitted instruction is still the better record.
      summary.unchanged += 1;
      continue;
    }

    const sent = row.payload as JpsSubmitPayload | null;
    const body = buildJpsAmendBody(sent, built.payload);
    if (!body) {
      summary.unchanged += 1;
      continue;
    }

    const jpsId = row.jps_id == null ? null : Number(row.jps_id);
    const res = await jpsRequest<JpsInstruction>(
      jpsId
        ? { method: 'PATCH', url: `/shipping-instructions/${jpsId}`, data: body }
        : {
            method: 'PATCH',
            url: '/shipping-instructions',
            params: { external_reference: String(row.external_reference) },
            data: body,
          },
    );

    if (res.ok) {
      // Store the payload KLIP now believes JPS holds, or the same diff would be sent every sweep.
      await query(
        `UPDATE jps_shipping_instructions
         SET payload = $2::jsonb, last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, JSON.stringify({ ...built.payload, external_reference: sent?.external_reference ?? built.payload.external_reference })],
      );
      summary.amended += 1;
      logger.info('JPS instruction amended', { stoKey: source.sto_key, fields: Object.keys(body) });
      continue;
    }

    if (res.code === 'INVALID_STATE') {
      /*
       * The operator decided between the poll and this call, so the instruction is no longer
       * Pending. Not an error: the poller will pick up the real status on its next pass, and JPS
       * offers no way to amend an approved instruction.
       */
      summary.blocked += 1;
      logger.info('JPS instruction can no longer be amended', { stoKey: source.sto_key });
      continue;
    }

    await query(
      `UPDATE jps_shipping_instructions
       SET last_error = $2, request_id = COALESCE($3, request_id), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, `amend ${res.code}: ${res.message}`, res.requestId ?? null],
    );
    summary.failed += 1;
    logger.warn('JPS amend failed', { stoKey: source.sto_key, code: res.code, status: res.status });
  }

  return summary;
}
