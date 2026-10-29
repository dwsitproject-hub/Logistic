/** Wire types for the JPS partner API (Shipping Instruction, up to v5.7). */

/**
 * Partner status values JPS reports back. Copied verbatim; KLIP does not translate them.
 *
 * v5.7 (2026-10-29) follows the vessel through five stages after approval: `Allocated` (jetty assigned), `Berthed` (TB set), `Start Cargo` (cargo window started: Hose On),
 * `Cargo Done` (cargo and final checks finished) and `Sailed Off` (cast off). `Sailed` was renamed `Sailed Off`; a row stored before that keeps the old text. A stage is derived
 * from times on the JPS side, so it can move BACK when an operator clears one.
 */
export type JpsPartnerStatus =
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Deleted'
  | 'Allocated'
  | 'Berthed'
  | 'Start Cargo'
  | 'Cargo Done'
  | 'Sailed Off'
  | 'Sailed';

/**
 * The statuses of an instruction that can still move, so the poller keeps asking about it and the schedule it carries (TA, TB, Hose On / Hose Off) keeps arriving. Under v5.7 the
 * poller used to stop at `Berthed` (it knew only Pending / Approved / Allocated), so the cargo window and the departure would have reached KLIP only by webhook.
 * The terminal ones are `Rejected`, `Deleted`, `Sailed Off` and the older `Sailed`.
 */
export const JPS_LIVE_STATUSES = ['Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done'] as const;

/** SQL list of JPS_LIVE_STATUSES for an IN (...); constants only, never user input. */
export const JPS_LIVE_STATUSES_SQL = JPS_LIVE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * Statuses in which JPS has CLOSED the instruction: it will not move again, and the way forward is a NEW instruction under a new reference (the next revision).
 * `Rejected` is documented (the operator declined). `Deleted` is not in any version of the partner guide (up to v5.6, 2026-10-27) but JPS answers it for an
 * instruction an operator deleted, and told us the STO may be sent again under R<n+1> (2026-10-27).
 */
export const JPS_CLOSED_STATUSES = ['Rejected', 'Deleted'] as const;

export function isJpsClosedStatus(status: string | null | undefined): boolean {
  return (JPS_CLOSED_STATUSES as readonly string[]).includes(String(status ?? ''));
}

/**
 * The berthing milestones v5.0 added to the GET response.
 *
 * KLIP records the same moments itself, from SAP and from Edit Shipment. These are kept as JPS's
 * own account of them rather than folded into those fields - see migration 188.
 */
export interface JpsSchedule {
  eta?: string | null;
  /** Time of Arrival, from the operator's arrival log. */
  ta?: string | null;
  etb?: string | null;
  /** Time of Berthing, actual. */
  tb?: string | null;
  etc?: string | null;
  /** Time of Completion, actual. */
  tc?: string | null;
  /**
   * Hose On (partner ATS): the START of the Cargo Operations window. v5.4 sent the Entry 1 start under the same name;
   * v5.5 redefined it as the window start. Absent from v5.3 responses.
   */
  cargo_ops_start_at?: string | null;
  /** v5.5. Hose Off (partner ATC): the END of the Cargo Operations window. Absent before v5.5. */
  cargo_ops_end_at?: string | null;
  cast_off_at?: string | null;
  sailed_at?: string | null;
}

export interface JpsApproval {
  status?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
}

export interface JpsCargoLine {
  /**
   * The DataHub code of the product (products.code_dhm). JPS renamed this from `cargo_type`, which it now
   * refuses: "legacy cargo_type is not accepted; use cargo_hub_code".
   */
  cargo_hub_code: string;
  description?: string;
  tonnage: number;
  unit: 'MT' | 'KL';
  contract_no?: string;
  po_no?: string;
  so_no?: string;
  /** The STO number of the line (JPS 5.6, max 100). Left out when the line has no STO. */
  sto_no?: string;
  shipper_name?: string;
}

export interface JpsSubmitPayload {
  external_reference: string;
  requested_by?: string;
  /**
   * DHM code of the discharge port (`master_loading_ports.code_dhm`).
   * JPS accepts this instead of the numeric `port_id`.
   */
  port_hub_code?: string;
  /** Older submissions stored this. New ones send `port_hub_code` and leave it off. */
  port_id?: number;
  /**
   * v5.6. The operating company (DataHub organisation, `master_companies.code_dhm`), not the cargo shipper.
   * JPS requires it when the port has more than one mapped company, stores the single company when it is omitted for
   * a port with one, and refuses any code for a port with none - so it is only sent after GET /catalog/company says
   * which of those the port is (companies.ts).
   */
  company_hub_code?: string;
  vessel_hub_code?: string;
  vessel_name?: string;
  voyage_no?: string;
  purpose: 'Loading' | 'Unloading';
  eta: string;
  etd?: string;
  /** Always sent, as null: KLIP has no shipping-agent master, so no agent is named. */
  agent_name: string | null;
  agent_contact?: string;
  trade_term?: string;
  surveyor_name?: string;
  notes?: string;
  /** HTTPS (or intranet HTTP) links. JPS stores the URL; the file stays on Synology. */
  shipping_instruction_document_url?: string;
  contract_document_url?: string;
  bl_document_url?: string;
  cargo: JpsCargoLine[];
}

export interface JpsInstruction {
  id: number;
  external_reference: string;
  status: JpsPartnerStatus;
  vessel_name?: string | null;
  vessel_hub_code?: string | null;
  voyage_no?: string | null;
  purpose?: string | null;
  eta?: string | null;
  etd?: string | null;
  port_id?: number | null;
  port_hub_code?: string | null;
  /** v5.6: echoed on the 201, GET and webhook `data`. Absent from older responses. */
  company_hub_code?: string | null;
  company_name?: string | null;
  allocation?: {
    jetty_name?: string | null;
    /** v5.0. */
    jetty_code?: string | null;
    planned_berthing_time?: string | null;
  } | null;
  /** v5.0 additions. A v4.x response simply omits them. */
  plan_reference?: string | null;
  approval?: JpsApproval | null;
  schedule?: JpsSchedule | null;
  etr_minutes?: number | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  last_updated_at?: string | null;
}

export interface JpsErrorDetail {
  field?: string;
  issue?: string;
  [key: string]: unknown;
}

/**
 * Every call resolves to one of these rather than throwing. JPS distinguishes outcomes KLIP has to
 * act on differently - a 409 on submit is success in disguise (the instruction already exists and
 * can be recovered by reference), while a 400 is permanent and must not be retried.
 */
export type JpsResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; details?: JpsErrorDetail[]; requestId?: string; retryable: boolean };
