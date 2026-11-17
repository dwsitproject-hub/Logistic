import { describe, expect, it } from 'vitest'
import { JPS_ESTIMATE_FIELD_BY_MODAL_KEY, jpsEstimateIso } from './JpsEstimateField'

describe('jpsEstimateIso: the JPS estimate the modal shows as the main value', () => {
  const jpsEst = {
    eta_vessel_arrive_at_discharge_port: '2026-11-13',
    eta_vessel_berthed_at_discharge_port: '2026-11-14',
    eta_vessel_complete_discharge: null,
  }

  it('maps the modal keys to JPS eta, etb and etc: ETA, ETB and ETC at Discharge Port', () => {
    expect(JPS_ESTIMATE_FIELD_BY_MODAL_KEY).toEqual({
      etaVesselArriveAtDischargePort: 'eta_vessel_arrive_at_discharge_port',
      etaVesselBerthedAtDischargePort: 'eta_vessel_berthed_at_discharge_port',
      etaVesselCompleteDischarge: 'eta_vessel_complete_discharge',
    })
    expect(jpsEstimateIso(jpsEst, 'etaVesselArriveAtDischargePort')).toBe('2026-11-13')
    expect(jpsEstimateIso(jpsEst, 'etaVesselBerthedAtDischargePort')).toBe('2026-11-14')
  })

  it('is empty when JPS has no value for the field, so the field keeps its normal control', () => {
    expect(jpsEstimateIso(jpsEst, 'etaVesselCompleteDischarge')).toBe('')
    expect(jpsEstimateIso(null, 'etaVesselArriveAtDischargePort')).toBe('')
    expect(jpsEstimateIso(undefined, 'etaVesselBerthedAtDischargePort')).toBe('')
  })

  it('is empty for a field JPS does not estimate (ETS at Discharge Port, the loading estimates)', () => {
    expect(jpsEstimateIso(jpsEst, 'etaVesselStartDischarging')).toBe('')
    expect(jpsEstimateIso(jpsEst, 'etaVesselArrivalAtLoadingPort')).toBe('')
  })

  it('ignores a value that is not a date', () => {
    expect(jpsEstimateIso({ eta_vessel_arrive_at_discharge_port: 'soon' }, 'etaVesselArriveAtDischargePort')).toBe('')
  })

  it('cuts a timestamp to its day', () => {
    expect(jpsEstimateIso({ eta_vessel_arrive_at_discharge_port: '2026-11-13T03:00:00.000Z' }, 'etaVesselArriveAtDischargePort')).toBe('2026-11-13')
  })
})
