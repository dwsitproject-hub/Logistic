import { describe, expect, it } from 'vitest';
import { buildJpsAmendBody } from './amend';
import type { JpsSubmitPayload } from './types';

const base = (over: Partial<JpsSubmitPayload> = {}): JpsSubmitPayload => ({
  external_reference: 'KLIP-STO-1-R1',
  port_id: 1,
  purpose: 'Unloading',
  eta: '2026-09-25T00:00:00Z',
  agent_name: 'Other',
  cargo: [{ cargo_type: 'CPO', tonnage: 100, unit: 'MT', contract_no: 'C-1', po_no: 'PO-1' }],
  ...over,
});

describe('buildJpsAmendBody', () => {
  it('sends nothing when nothing amendable has moved', () => {
    expect(buildJpsAmendBody(base(), base())).toBeNull();
  });

  it('ignores a changed eta, which JPS will not accept on a PATCH', () => {
    const moved = base({ eta: '2026-10-01T00:00:00Z' });
    expect(buildJpsAmendBody(base(), moved)).toBeNull();
  });

  it('sends a trade term that has changed', () => {
    const sent = base({ trade_term: 'FOB' });
    const now = base({ trade_term: 'CIF' });
    expect(buildJpsAmendBody(sent, now)).toEqual({ trade_term: 'CIF' });
  });

  it('does not try to clear a trade term that has become unmappable', () => {
    const sent = base({ trade_term: 'FOB' });
    const now = base();
    expect(buildJpsAmendBody(sent, now)).toBeNull();
  });

  it('identifies a cargo line by contract_no, not by position', () => {
    const sent = base({
      cargo: [
        { cargo_type: 'CPO', tonnage: 100, unit: 'MT', contract_no: 'C-1', po_no: 'PO-1' },
        { cargo_type: 'PK', tonnage: 50, unit: 'MT', contract_no: 'C-2', po_no: 'PO-2' },
      ],
    });
    // C-1 has dropped off, so C-2 is now first. Matching by line_order would write C-2's new PO
    // onto C-1's row at JPS.
    const now = base({
      cargo: [{ cargo_type: 'PK', tonnage: 50, unit: 'MT', contract_no: 'C-2', po_no: 'PO-9' }],
    });
    expect(buildJpsAmendBody(sent, now)).toEqual({
      cargo: [{ contract_no: 'C-2', po_no: 'PO-9' }],
    });
  });

  it('leaves a cargo line JPS does not have alone, because PATCH cannot add one', () => {
    const now = base({
      cargo: [
        { cargo_type: 'CPO', tonnage: 100, unit: 'MT', contract_no: 'C-1', po_no: 'PO-1' },
        { cargo_type: 'PK', tonnage: 50, unit: 'MT', contract_no: 'C-NEW', po_no: 'PO-NEW' },
      ],
    });
    expect(buildJpsAmendBody(base(), now)).toBeNull();
  });

  it('sends nothing when the instruction was never recorded', () => {
    expect(buildJpsAmendBody(null, base())).toBeNull();
  });
});
