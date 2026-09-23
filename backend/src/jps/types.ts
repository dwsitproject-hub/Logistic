/** Wire types for the JPS partner API (Shipping Instruction, v4.2). */

/** Partner status values JPS reports back. Copied verbatim; KLIP does not translate them. */
export type JpsPartnerStatus = 'Pending' | 'Approved' | 'Rejected' | 'Allocated';

export interface JpsCargoLine {
  cargo_type: string;
  description?: string;
  tonnage: number;
  unit: 'MT' | 'KL';
  contract_no?: string;
  po_no?: string;
  so_no?: string;
  shipper_name?: string;
}

export interface JpsSubmitPayload {
  external_reference: string;
  requested_by?: string;
  port_id: number;
  vessel_hub_code?: string;
  vessel_name?: string;
  voyage_no?: string;
  purpose: 'Loading' | 'Unloading';
  eta: string;
  etd?: string;
  agent_name: string;
  agent_contact?: string;
  trade_term?: string;
  surveyor_name?: string;
  notes?: string;
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
  allocation?: { jetty_name?: string | null; planned_berthing_time?: string | null } | null;
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
