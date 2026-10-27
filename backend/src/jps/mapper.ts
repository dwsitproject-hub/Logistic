/**
 * KLIP shipment/contract data -> JPS Shipping Instruction payload.
 *
 * Pure functions: no database, no HTTP. Every rule here was settled with Ryan on 2026-09-23 and
 * several were verified against the live staging API rather than the partner document, which is
 * out of date in places (see JPS_CARGO_TYPES below).
 */
import type { JpsCargoLine, JpsSubmitPayload } from './types';

/*
 * cargo_hub_code is the DataHub code of the product (products.code_dhm, e.g. CMD-0006 for CPO), the same code on
 * both sides since JPS moved its masters to DataHub. It used to be `cargo_type`, a short name read from JPS's
 * valid_cargo_types list (CPO, PK, PKS, ...) through a table in this file; JPS now refuses that name ("legacy
 * cargo_type is not accepted; use cargo_hub_code"). The table is gone, and a product with no code is held rather
 * than sent under a guessed one.
 */

/**
 * JPS accepts only the trade terms in `GET /terms`: FOB, CIF, CFR (plus a stray "1"). KLIP's two
 * most common incoterms, FRC (12,056 contracts) and LCO (4,018), have no counterpart. The field is
 * optional, so an unmappable incoterm is omitted rather than substituted.
 */
const JPS_TRADE_TERMS = new Set(['FOB', 'CIF', 'CFR']);

export function mapKlipIncotermToJpsTradeTerm(incoterm: unknown): string | undefined {
  const key = String(incoterm ?? '').trim().toUpperCase();
  return JPS_TRADE_TERMS.has(key) ? key : undefined;
}

/**
 * `eta`/`etd` must be ISO 8601 UTC. KLIP stores these as DATE with no time of day, so midnight UTC
 * is the honest rendering - JPS operators set the real berthing time during allocation.
 *
 * The calendar day must survive, and toISOString() does not preserve it. `pg` hands a DATE back as
 * a JS Date at LOCAL midnight, so on a UTC+7 server toISOString() rolls it to 17:00 the previous
 * day - an ETA stored as 2026-09-18 went out as 2026-09-17, a day early for a berth booking. The
 * local calendar components are the ones the database meant.
 */
export function toJpsDateTime(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const iso = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return `${iso[1]}T00:00:00Z`;
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${day}T00:00:00Z`;
}

export function buildJpsExternalReference(stoKey: string, revision: number): string {
  return `KLIP-${String(stoKey).trim()}-R${Math.max(1, Math.trunc(revision))}`;
}

export interface JpsCargoSource {
  /** contracts.contract_id */
  contract_no: string | null;
  /** contracts.po_number */
  po_no: string | null;
  /**
   * The STO number of this line (contract_stos.sto_number), sent as the cargo line's `sto_no` (JPS 5.6). NULL when the line has no STO of its own - a manual
   * shipment, or a transaction without one such as CIF - and then nothing is sent in its place: no other identifier (operation id, shipment id) stands in for it.
   */
  sto_no?: string | null;
  /** contracts.product */
  product: string | null;
  /** products.code_dhm of that product, the DataHub code JPS takes as cargo_hub_code. Empty until Master Product is synced. */
  product_hub_code?: string | null;
  /** The product's Master Product was deleted in DHM: no code is sent for it, and the hold says why. */
  product_deleted?: boolean;
  /** contract_stos.sto_quantity, in KILOGRAMS */
  sto_quantity_kg: number | null;
  /** contracts.quantity_ordered, in KILOGRAMS - used only to flag a suspect sto_quantity */
  contract_quantity_kg?: number | null;
}

export interface JpsShipmentSource {
  sto_key: string;
  revision: number;
  vessel_name: string | null;
  vessel_hub_code: string | null;
  /** The Master Vessel was deleted in DHM (dhm_is_deleted): no code is sent, and the hold says why. */
  vessel_deleted?: boolean;
  /** `master_loading_ports.code_dhm` for the discharge port. Empty until that port is synced on SIT. */
  port_hub_code: string | null;
  /** The Master Port was deleted in DHM (dhm_is_deleted): no code is sent, and the hold says why. */
  port_deleted?: boolean;
  eta_discharge_arrival: unknown;
  eta_discharge_complete: unknown;
  incoterm: string | null;
  /**
   * The operating company of the STO, from the SAP Company Code its contracts carry, through Master Company (Internal).
   * `company_hub_code` is that master's `code_dhm` (a DataHub organisation, ORG-xxxx). Empty when the contracts carry no
   * Company Code, the code has no Master Company, or that master has no DHM code yet.
   */
  company_code?: string | null;
  company_hub_code?: string | null;
  /** The Master Company was deleted in DHM: no code is sent, and the hold says why. */
  company_deleted?: boolean;
  /** The STO's contracts carry more than one SAP Company Code. One instruction names one company, so none is sent. */
  company_conflict?: string[] | null;
  requested_by?: string | null;
  /** Already-built download links. Omitted from the payload when empty. */
  contract_document_url?: string | null;
  shipping_instruction_document_url?: string | null;
  bl_document_url?: string | null;
  cargo: JpsCargoSource[];
}

export interface JpsPayloadResult {
  payload?: JpsSubmitPayload;
  /** Reasons the STO cannot be submitted as-is. Empty when `payload` is set. */
  problems: string[];
}

export interface JpsCompanyDecision {
  /** The code to put on the payload. Absent when none should be sent. */
  companyHubCode?: string;
  /** Why the STO cannot be submitted without a company. Set only when JPS would refuse the submit for lack of one. */
  problem?: string;
}

function sameCode(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * Whether the payload carries `company_hub_code`, given what JPS says about the port (companies.ts: `portCompanies`).
 *
 *   unknown (null)  nothing is sent and nothing is held - what KLIP did before v5.6.
 *   none mapped     nothing is sent; JPS refuses any code for a port without companies.
 *   exactly one     omitted unless KLIP's company is that one; JPS stores the port's company either way.
 *   two or more     required. KLIP's company must be one of them, otherwise the STO is held with the reason and is picked up
 *                   again once the master data is fixed - instead of going out to a 400 that is recorded as FAILED for good.
 */
export function decideJpsCompany(
  source: Pick<
    JpsShipmentSource,
    'port_hub_code' | 'company_code' | 'company_hub_code' | 'company_deleted' | 'company_conflict'
  >,
  portCompanies: string[] | null | undefined,
): JpsCompanyDecision {
  if (!portCompanies || portCompanies.length === 0) return {};

  const hub = String(source.company_hub_code ?? '').trim();
  const match = hub ? portCompanies.find((code) => sameCode(code, hub)) : undefined;
  if (portCompanies.length === 1) return match ? { companyHubCode: hub } : {};
  if (match) return { companyHubCode: hub };

  const port = String(source.port_hub_code ?? '').trim() || 'this port';
  const valid = portCompanies.join(', ');
  const code = String(source.company_code ?? '').trim();
  const conflict = (source.company_conflict ?? []).filter(Boolean);
  let reason: string;
  if (conflict.length > 1) {
    reason = `the STO's contracts carry different SAP Company Codes (${conflict.join(', ')}), and one instruction names one company`;
  } else if (!code) {
    reason = 'the STO\'s contracts carry no SAP Company Code';
  } else if (source.company_deleted) {
    reason = `Master Company "${code}" was deleted in DHM`;
  } else if (!hub) {
    reason = `no DHM code on Master Company for SAP Company Code "${code}"`;
  } else {
    reason = `Master Company "${code}" (${hub}) is not mapped to ${port} at JPS`;
  }
  return { problem: `JPS needs an operating company at ${port} (valid: ${valid}), but ${reason}` };
}

export interface BuildJpsPayloadOptions {
  /**
   * The companies JPS maps to the STO's port (companiesForPort in companies.ts): a list when the catalog was read, null
   * when it could not be, which leaves `company_hub_code` out and holds nothing for it.
   */
  portCompanies?: string[] | null;
}

/** KLIP stores quantities in kilograms; JPS wants MT. */
function kgToMt(kg: number): number {
  return Math.round((kg / 1000) * 100) / 100;
}

/** JPS stores the link only. A relative path or a blank value is not a URL it can open. */
function absoluteDocumentUrl(value: string | null | undefined): string | undefined {
  const url = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return undefined;
  return url;
}

/**
 * Build one instruction for one STO.
 *
 * Tonnage comes from `contract_stos.sto_quantity` - the quantity SAP allocated to THIS voyage -
 * not from the contract quantity. Measured on a copy of production: for the 34% of edges whose
 * contract spans several STOs, the contract quantity overstates the load by 80%, and 43 of 209
 * STOs would then exceed the carrying vessel's own capacity against 16 using sto_quantity.
 *
 * `shipper_name` is deliberately never sent. JPS rejects a shipper that is not already in its
 * master ("unknown shipper: ... Create it first via POST /shippers", verified on staging), and the
 * 57 suppliers in BONTANG scope do not match its 25 registered names without a human mapping.
 */
export function buildJpsSubmitPayload(
  source: JpsShipmentSource,
  options: BuildJpsPayloadOptions = {},
): JpsPayloadResult {
  const problems: string[] = [];

  const eta = toJpsDateTime(source.eta_discharge_arrival);
  if (!eta) problems.push('ETA discharge arrival is empty');

  // JPS 5.3 (GET /catalog) makes port_hub_code and vessel_hub_code required, and lists no other way to name a port or a
  // vessel, so an STO whose port or vessel has no DataHub code is held with the reason instead of sent to be refused.
  const portHubCode = String(source.port_hub_code ?? '').trim();
  if (!portHubCode) {
    problems.push(
      source.port_deleted
        ? 'discharge port was deleted in DHM (Master Port)'
        : 'discharge port has no DHM code on Master Port',
    );
  }

  const vesselHubCode = String(source.vessel_hub_code ?? '').trim();
  if (!vesselHubCode) {
    const vesselName = String(source.vessel_name ?? '').trim();
    problems.push(
      source.vessel_deleted
        ? `Master Vessel "${vesselName}" was deleted in DHM`
        : `no DHM code on Master Vessel for "${vesselName}"`,
    );
  }

  const company = decideJpsCompany(source, options.portCompanies);
  if (company.problem) problems.push(company.problem);

  const cargo: JpsCargoLine[] = [];
  for (const line of source.cargo) {
    const cargoHubCode = String(line.product_hub_code ?? '').trim();
    if (!cargoHubCode) {
      const productName = String(line.product ?? '').trim();
      problems.push(
        line.product_deleted
          ? `Master Product "${productName}" was deleted in DHM`
          : `no DHM code on Master Product for "${productName}"`,
      );
      continue;
    }
    const kg = Number(line.sto_quantity_kg ?? 0);
    if (!Number.isFinite(kg) || kg <= 0) {
      problems.push(`contract ${line.contract_no ?? '?'} has no STO quantity`);
      continue;
    }
    // A contract whose STO quantities do not add back up to its own quantity is a SAP data fault,
    // not a rounding difference - one contract of 5,000 MT was spread over five STOs totalling
    // 10,000. Sending it would book berth space for cargo that does not exist.
    const contractKg = Number(line.contract_quantity_kg ?? 0);
    if (contractKg > 0 && kg > contractKg * 1.1) {
      problems.push(
        `contract ${line.contract_no ?? '?'}: STO qty ${kgToMt(kg)} MT exceeds contract qty ${kgToMt(contractKg)} MT by more than 10%`,
      );
      continue;
    }
    cargo.push({
      cargo_hub_code: cargoHubCode,
      tonnage: kgToMt(kg),
      unit: 'MT',
      ...(line.contract_no ? { contract_no: line.contract_no } : {}),
      ...(line.po_no ? { po_no: line.po_no } : {}),
      ...(String(line.sto_no ?? '').trim() ? { sto_no: String(line.sto_no).trim().slice(0, 100) } : {}),
    });
  }

  if (cargo.length === 0) problems.push('no cargo line could be built');

  if (problems.length > 0) return { problems };

  const etd = toJpsDateTime(source.eta_discharge_complete);
  const payload: JpsSubmitPayload = {
    external_reference: buildJpsExternalReference(source.sto_key, source.revision),
    port_hub_code: portHubCode,
    ...(company.companyHubCode ? { company_hub_code: company.companyHubCode } : {}),
    vessel_hub_code: vesselHubCode,
    purpose: 'Unloading',
    eta: eta as string,
    // No agent: KLIP has no shipping-agent master. It used to send the fixed "Other" (a JPS row, GET /agents id 5);
    // JPS is now asked for none, so the field goes as an explicit null.
    agent_name: null,
    cargo,
  };
  // vessel_name is an optional cross-check that "must match master", and the hub code already names the vessel, so
  // it is not sent: a spelling difference would be a refusal for no gain.
  // JPS rejects an etd that is not after eta; a same-day discharge would trip that.
  if (etd && etd > (eta as string)) payload.etd = etd;
  const tradeTerm = mapKlipIncotermToJpsTradeTerm(source.incoterm);
  if (tradeTerm) payload.trade_term = tradeTerm;
  if (source.requested_by) payload.requested_by = String(source.requested_by).trim();
  const contractDocumentUrl = absoluteDocumentUrl(source.contract_document_url);
  const siDocumentUrl = absoluteDocumentUrl(source.shipping_instruction_document_url);
  const blDocumentUrl = absoluteDocumentUrl(source.bl_document_url);
  if (contractDocumentUrl) payload.contract_document_url = contractDocumentUrl;
  if (siDocumentUrl) payload.shipping_instruction_document_url = siDocumentUrl;
  if (blDocumentUrl) payload.bl_document_url = blDocumentUrl;

  return { payload, problems: [] };
}
