import { describe, expect, it } from 'vitest';
import { parseInboundBody } from './inbound';

const record = {
  id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  isDeleted: false,
  data: { code: 'VSL-0001', Vessel_Name: 'ALPHA' },
  updatedAt: '2026-09-15T02:00:00.000Z',
};

describe('parseInboundBody', () => {
  it('treats 201 created as success', () => {
    const result = parseInboundBody(201, { status: 'created', code: 'VSL-0001', record });
    expect(result).toMatchObject({ ok: true, status: 'created', code: 'VSL-0001' });
  });

  it('treats 200 updated as success', () => {
    const result = parseInboundBody(200, { status: 'updated', code: 'VSL-0001', record });
    expect(result).toMatchObject({ ok: true, status: 'updated' });
  });

  it('treats 409 as conflict without inventing a new local row', () => {
    const result = parseInboundBody(409, { status: 'duplicate', inboundId: 'inb-1', record });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(true);
      expect(result.record.data.code).toBe('VSL-0001');
    }
  });

  it('surfaces 400 schema errors', () => {
    const result = parseInboundBody(400, { error: 'Unknown fields in record data', unknownKeys: ['owner'] });
    expect(result).toMatchObject({ ok: false, conflict: false, httpStatus: 400 });
  });
});
