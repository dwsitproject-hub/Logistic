import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ dhmRequest: vi.fn() }));
vi.mock('./catalog', () => ({ getDhmVesselTypeEnumValues: vi.fn() }));

import { dhmRequest } from './client';
import { getDhmVesselTypeEnumValues } from './catalog';
import { fromDhmVesselData, isTugVesselType, pickDhmVesselType, toDhmVesselPayload } from './mapper';
import { postVesselInbound, putVesselInbound } from './inbound';

const request = vi.mocked(dhmRequest);
const enumValues = vi.mocked(getDhmVesselTypeEnumValues);
const tug = { vessel_name: 'TB. ARGO 10', vessel_type: 'TUG BOAT', vessel_code: 'TMP-ARGO10' };

describe('a tug boat on the DHM vessel push', () => {
  it('is recognised however it is written', () => {
    for (const v of ['TUG BOAT', 'Tug Boat', 'tugboat', 'TUG', 'TUG-BOAT']) expect(isTugVesselType(v), v).toBe(true);
    for (const v of ['BARGE', 'TANKER', 'SPOB', '', null, undefined]) expect(isTugVesselType(v), String(v)).toBe(false);
  });

  it('is sent with the Hub\'s own spelling once the Hub lists a tug value', () => {
    expect(pickDhmVesselType('TUG BOAT', ['barge', 'tanker', 'SPOB', 'tugboat'])).toBe('tugboat');
    expect(pickDhmVesselType('TUG BOAT', ['barge', 'Tug Boat'])).toBe('Tug Boat');
    expect(toDhmVesselPayload(tug, { vesselTypeEnum: ['barge', 'tugboat'] })).toMatchObject({ Vessel_Name: 'TB. ARGO 10', Vessel_Type: 'tugboat' });
  });

  it('is pushed WITHOUT a type - never with a guessed one - while the Hub has no tug value', () => {
    expect(pickDhmVesselType('TUG BOAT', ['barge', 'tanker', 'SPOB'])).toBeUndefined();
    expect(pickDhmVesselType('TUG BOAT', null)).toBeUndefined();
    const payload = toDhmVesselPayload(tug, { vesselTypeEnum: ['barge', 'tanker', 'SPOB'] });
    expect(payload).not.toHaveProperty('Vessel_Type');
    expect(payload).toHaveProperty('Vessel_Name', 'TB. ARGO 10');
  });

  it('never sends the TMP- placeholder as the SAP code', () => {
    expect(toDhmVesselPayload(tug, { vesselTypeEnum: ['tugboat'] })).not.toHaveProperty('Vessel_Code_SAP');
  });

  it('leaves barge, tanker and SPOB exactly as before', () => {
    expect(pickDhmVesselType('BARGE', ['tugboat'])).toBe('barge');
    expect(pickDhmVesselType('TANKER')).toBe('tanker');
    expect(pickDhmVesselType('SPOB', null)).toBe('SPOB');
  });

  it('is read back from the Hub as TUG BOAT', () => {
    expect(fromDhmVesselData({ Vessel_Type: 'tugboat' }).vessel_type).toBe('TUG BOAT');
    expect(fromDhmVesselData({ Vessel_Type: 'barge' }).vessel_type).toBe('BARGE');
    expect(fromDhmVesselData({}).vessel_type).toBeNull();
  });
});

describe('postVesselInbound / putVesselInbound', () => {
  beforeEach(() => {
    request.mockReset();
    enumValues.mockReset();
    request.mockResolvedValue({ status: 201, data: { id: 'x', version: 1, data: { code: 'VSL-0001' } } } as never);
  });

  it('read the Hub enum only for a tug, so every other push makes no extra call', async () => {
    await postVesselInbound({ vessel_name: 'BG. SOLID 10', vessel_type: 'BARGE' });
    expect(enumValues).not.toHaveBeenCalled();

    enumValues.mockResolvedValue(['barge', 'tugboat']);
    await postVesselInbound(tug);
    expect(enumValues).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'POST', data: { Vessel_Type: 'tugboat' } });
  });

  it('send a tug without a type when the Hub has none for it, on create and on update', async () => {
    enumValues.mockResolvedValue(['barge', 'tanker', 'SPOB']);
    await postVesselInbound(tug);
    await putVesselInbound('VSL-0001', tug);
    for (const call of request.mock.calls) {
      const body = (call[0] as { data: Record<string, unknown> }).data;
      expect(body).not.toHaveProperty('Vessel_Type');
      expect(body).toHaveProperty('Vessel_Name', 'TB. ARGO 10');
    }
  });
});
