export interface DhmRecord {
  id: string;
  version: number;
  isDeleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
}

export type DhmInboundStatus = 'created' | 'updated' | 'unchanged' | 'duplicate';

export interface DhmInboundSuccess {
  ok: true;
  status: Exclude<DhmInboundStatus, 'duplicate'>;
  code: string;
  inboundId?: string;
  record: DhmRecord;
}

export interface DhmInboundConflict {
  ok: false;
  conflict: true;
  status: 'duplicate';
  code?: string;
  inboundId?: string;
  record: DhmRecord;
}

export interface DhmInboundFailure {
  ok: false;
  conflict: false;
  httpStatus: number;
  error: string;
}

export type DhmInboundResult = DhmInboundSuccess | DhmInboundConflict | DhmInboundFailure;

export interface KlipVesselForDhm {
  vessel_code?: string | null;
  vessel_name: string;
  vessel_capacity_mt?: number | null;
  heating?: boolean | null;
  vessel_type?: string | null;
  lambung_type?: string | null;
  terms?: string | null;
}

export interface DhmWebhookPayload {
  event: 'record.created' | 'record.updated' | 'record.deleted' | string;
  occurredAt?: string;
  eventId?: string;
  deliveryId: string;
  entityType: string;
  recordId: string;
  version?: number;
  data?: Record<string, unknown>;
  sourceApplication?: string;
}
