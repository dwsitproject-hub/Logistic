import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SaveEditShipmentInput } from './editShipmentModalSave'

const putMock = vi.fn()
const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('@/lib/api', () => ({
  default: {
    put: (...args: unknown[]) => putMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))

import { saveEditShipmentChanges } from './editShipmentModalSave'

function baseInput(over: Partial<SaveEditShipmentInput> = {}): SaveEditShipmentInput {
  return {
    shipmentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    vesselName: 'VESSEL',
    originalVesselName: 'VESSEL',
    sfalQty: null,
    sfbdQty: null,
    originalSfalQty: null,
    originalSfbdQty: null,
    fuelConsumption: null,
    freight: null,
    pumpRate: null,
    sailingSpeed: null,
    autoPersistShortageMt: -3.5,
    originalFuelConsumption: null,
    originalFreight: null,
    originalPumpRate: null,
    originalSailingSpeed: null,
    originalShortage: null,
    loadingPort: 'POL',
    dischargePort: 'POD',
    activeEta: {
      etaVesselArrivalAtLoadingPort: '2026-07-01',
      etaVesselBerthedAtLoadingPort: '',
      etaVesselStartLoading: '',
      etaVesselCompletedLoading: '',
      etaVesselSailedFromLoadingPort: '',
      etaVesselArriveAtDischargePort: '',
      etaVesselBerthedAtDischargePort: '',
      etaVesselStartDischarging: '',
      etaVesselCompleteDischarge: '',
    },
    qtyRows: [
      {
        rowKey: 'a',
        contract_ext_no: '1004030778',
        po_number: '1001030778',
        quantity_delivered: 100_000,
        quantity_receive: 90_000,
      },
      {
        rowKey: 'b',
        contract_ext_no: '1014003113',
        po_number: '1011003113',
        quantity_delivered: 200_000,
        quantity_receive: 180_000,
      },
    ],
    qtyEdits: {
      a: { quantity_delivered: 111_000 },
      b: { quantity_delivered: 222_000 },
    },
    originalDeliveredKg: 300_000,
    originalReceiveKg: 270_000,
    quantityUnlocked: true,
    hasSldOrSddDoc: true,
    loadingPorts: [],
    ...over,
  }
}

describe('saveEditShipmentChanges po-klip-qty', () => {
  beforeEach(() => {
    putMock.mockReset()
    getMock.mockReset()
    postMock.mockReset()
    putMock.mockResolvedValue({ data: { success: true } })
    getMock.mockResolvedValue({ data: { success: true, data: { ports: [] } } })
  })

  it('saves per-PO KLIP qty via /po-klip-qty and does not sum onto PUT /shipments/:id', async () => {
    await saveEditShipmentChanges(baseInput())

    const shipmentPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/shipments\/[^/]+$/.test(String(c[0])),
    )
    expect(shipmentPuts.length).toBeGreaterThanOrEqual(1)
    const body = shipmentPuts[0][1] as Record<string, unknown>
    expect(body.quantity_delivered).toBeUndefined()
    expect(body.actual_vessel_qty_receive).toBeUndefined()

    const klipPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('/po-klip-qty'),
    )
    expect(klipPuts).toHaveLength(1)
    expect(klipPuts[0][1]).toEqual({
      rows: [
        {
          contractNumber: '1004030778',
          poNumber: '1001030778',
          quantityDeliveredKlipKg: 111_000,
          quantityReceiveKlipKg: null,
        },
        {
          contractNumber: '1014003113',
          poNumber: '1011003113',
          quantityDeliveredKlipKg: 222_000,
          quantityReceiveKlipKg: null,
        },
      ],
    })
  })

  it('saves Delivered Qty (Klip) without SLD/SDD', async () => {
    await saveEditShipmentChanges(
      baseInput({
        quantityUnlocked: false,
        hasSldOrSddDoc: false,
      }),
    )

    const klipPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('/po-klip-qty'),
    )
    expect(klipPuts).toHaveLength(1)
  })

  it('rejects Received Qty (Klip) edits without SLD/SDD', async () => {
    await expect(
      saveEditShipmentChanges(
        baseInput({
          qtyEdits: { a: { quantity_receive: 91_000 } },
          quantityUnlocked: false,
          hasSldOrSddDoc: false,
        }),
      ),
    ).rejects.toThrow('Please upload an SLD or SDD document before editing Received Qty (Klip).')
    expect(putMock).not.toHaveBeenCalled()
  })

  it('persists auto-computed R4 shortage MT when it differs from original', async () => {
    await saveEditShipmentChanges(
      baseInput({ autoPersistShortageMt: -3.5, originalShortage: 0 }),
    )

    const shipmentPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/shipments\/[^/]+$/.test(String(c[0])),
    )
    const body = shipmentPuts[0][1] as Record<string, unknown>
    expect(body.shortage).toBe(-3.5)
  })

  it('persists SFAL and SFBD from View Shipment without KLIP delivery or receive', async () => {
    await saveEditShipmentChanges(
      baseInput({
        ataQualityOnly: true,
        sfalQty: 4_953_348,
        originalSfalQty: 4_953_348_000,
        sfbdQty: 4_938_215,
        originalSfbdQty: null,
      }),
    )

    const shipmentPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/shipments\/[^/]+$/.test(String(c[0])),
    )
    expect(shipmentPuts).toHaveLength(1)
    expect(shipmentPuts[0][1]).toEqual({
      sfal_qty: 4_953_348,
      sfbd_qty: 4_938_215,
    })
    const klipPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('/po-klip-qty'),
    )
    expect(klipPuts).toHaveLength(0)
  })

  it('does not persist shortage when auto-computed value matches original', async () => {
    await saveEditShipmentChanges(
      baseInput({ autoPersistShortageMt: -3.5, originalShortage: -3.5 }),
    )

    const shipmentPuts = putMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/shipments\/[^/]+$/.test(String(c[0])),
    )
    const body = shipmentPuts[0][1] as Record<string, unknown>
    expect(body.shortage).toBeUndefined()
  })
})
