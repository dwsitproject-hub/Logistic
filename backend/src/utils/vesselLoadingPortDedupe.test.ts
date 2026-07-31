import { describe, expect, it } from 'vitest';
import {
  dedupeStoGroupPorts,
  isPlaceholderPortName,
  normalizePortIdentity,
  portRowDataScore,
} from './vesselLoadingPortDedupe';

const port = (over: Record<string, unknown> = {}) => ({
  id: Math.random().toString(36).slice(2),
  shipment_id: 'ship-a',
  port_name: 'Pangkal Balam - TL',
  port_sequence: 1,
  is_discharge_port: false,
  eta_vessel_arrival: null,
  ata_vessel_arrival: null,
  quality_ffa: null,
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
});

describe('isPlaceholderPortName', () => {
  it('treats generic labels and blanks as unnamed', () => {
    for (const n of ['', '   ', 'Loading Port 1', 'loading port', 'Discharge Port', 'Port 2']) {
      expect(isPlaceholderPortName(n)).toBe(true);
    }
  });

  it('treats a bare number as unnamed (the "73.15" corruption)', () => {
    expect(isPlaceholderPortName('73.15')).toBe(true);
    expect(isPlaceholderPortName('1016')).toBe(true);
  });

  it('keeps real port names', () => {
    for (const n of ['Pangkal Balam - TL', 'PORT KETAPANG', 'JETTY SMP MATAN']) {
      expect(isPlaceholderPortName(n)).toBe(false);
    }
  });
});

describe('dedupeStoGroupPorts', () => {
  it('collapses the reported STO 1016010973 case to one port per slot', () => {
    // Two shipments of the same STO, same physical port; only one carries the ETA.
    const rows = [
      port({ shipment_id: 'ship-a', ata_vessel_arrival: '2026-07-09T00:00:00Z', quality_ffa: 3 }),
      port({ shipment_id: 'ship-b', eta_vessel_arrival: '2026-07-08T00:00:00Z', ata_vessel_arrival: '2026-07-09T00:00:00Z', quality_ffa: 3 }),
      port({ shipment_id: 'ship-a', port_name: 'Discharge Port', port_sequence: 999, is_discharge_port: true }),
      port({ shipment_id: 'ship-b', port_name: 'Discharge Port', port_sequence: 999, is_discharge_port: true, quality_ffa: 2 }),
    ];
    const out = dedupeStoGroupPorts(rows);
    expect(out).toHaveLength(2);
    // The populated rows survive — the user saw the empty one rendered first.
    expect(out[0].eta_vessel_arrival).toBe('2026-07-08T00:00:00Z');
    expect(out[1].is_discharge_port).toBe(true);
  });

  it('drops a placeholder-named row when a real port name exists in the slot', () => {
    const rows = [
      port({ shipment_id: 'ship-a', port_name: 'Loading Port 1' }),
      port({ shipment_id: 'ship-b', port_name: 'PORT KETAPANG' }),
    ];
    const out = dedupeStoGroupPorts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].port_name).toBe('PORT KETAPANG');
  });

  it('collapses the same berth named two ways (STO 1006018452)', () => {
    // SAP name-mapping had already turned a "0.00" row into "Bulungan", so both rows looked
    // real and the duplicate survived the first version of this fix.
    const rows = [
      port({ shipment_id: 'ship-a', port_name: 'Bulungan' }),
      port({ shipment_id: 'ship-b', port_name: 'PORT BULUNGAN', eta_vessel_arrival: '2026-07-02' }),
    ];
    const out = dedupeStoGroupPorts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].port_name).toBe('PORT BULUNGAN');
  });

  it('KEEPS two genuinely different real ports in the same slot', () => {
    // 33 production slots look like this; collapsing them would lose a real port call.
    const rows = [
      port({ shipment_id: 'ship-a', port_name: 'PORT MUARA KAMAN' }),
      port({ shipment_id: 'ship-b', port_name: 'PORT SEBULU' }),
    ];
    expect(dedupeStoGroupPorts(rows)).toHaveLength(2);
  });

  it('keeps distinct sequences and the discharge row untouched', () => {
    const rows = [
      port({ port_sequence: 1 }),
      port({ port_sequence: 2, port_name: 'PORT DUMAI' }),
      port({ port_sequence: 999, is_discharge_port: true, port_name: 'Discharge Port' }),
    ];
    expect(dedupeStoGroupPorts(rows)).toHaveLength(3);
  });

  it('prefers the anchor shipment row when both are equally empty', () => {
    const rows = [
      port({ shipment_id: 'ship-b' }),
      port({ shipment_id: 'ship-a' }),
    ];
    const out = dedupeStoGroupPorts(rows, 'ship-a');
    expect(out).toHaveLength(1);
    expect(out[0].shipment_id).toBe('ship-a');
  });

  it('falls back to the most recently updated on a full tie', () => {
    const rows = [
      port({ shipment_id: 'ship-b', updated_at: '2026-07-01T00:00:00Z' }),
      port({ shipment_id: 'ship-c', updated_at: '2026-07-20T00:00:00Z' }),
    ];
    const out = dedupeStoGroupPorts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].shipment_id).toBe('ship-c');
  });

  it('is a no-op for a single shipment with normal ports', () => {
    const rows = [port(), port({ port_sequence: 999, is_discharge_port: true, port_name: 'Discharge Port' })];
    expect(dedupeStoGroupPorts(rows)).toEqual(rows);
  });

  it('handles empty and single-row input', () => {
    expect(dedupeStoGroupPorts([])).toEqual([]);
    const one = [port()];
    expect(dedupeStoGroupPorts(one)).toEqual(one);
  });

  it('scores populated rows above empty ones', () => {
    expect(portRowDataScore(port({ eta_vessel_arrival: 'x', quality_ffa: 1 }))).toBeGreaterThan(
      portRowDataScore(port()),
    );
    // Identity columns must not inflate the score.
    expect(portRowDataScore(port())).toBe(0);
  });
});

describe('normalizePortIdentity', () => {
  it('treats descriptor prefixes and punctuation as noise', () => {
    expect(normalizePortIdentity('PORT BULUNGAN')).toBe(normalizePortIdentity('Bulungan'));
    expect(normalizePortIdentity('Jetty  SMP   Matan')).toBe(normalizePortIdentity('SMP MATAN'));
    expect(normalizePortIdentity('pangkal-balam')).toBe('PANGKAL BALAM');
  });

  it('keeps different berths distinct', () => {
    expect(normalizePortIdentity('PORT SEBULU')).not.toBe(normalizePortIdentity('PORT MUARA KAMAN'));
  });
});
