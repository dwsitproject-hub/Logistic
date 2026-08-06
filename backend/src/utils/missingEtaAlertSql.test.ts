import { describe, expect, it } from 'vitest';
import {
  buildContractsMissingEtaNearCargoReadinessSql,
  buildMissingEtaAlertUnitsSql,
  MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS,
} from './missingEtaAlertSql';

describe('missingEtaAlertSql', () => {
  it('buildContractsMissingEtaNearCargoReadinessSql matches email contract-level criteria', () => {
    const sql = buildContractsMissingEtaNearCargoReadinessSql();
    expect(sql).toContain('cargo_readiness_date <= CURRENT_DATE + INTERVAL');
    expect(sql).toContain(`INTERVAL '${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days'`);
    expect(sql).toContain('sea_missing_eta');
    expect(sql).toContain('land_missing_eta');
    expect(sql).toContain("LIKE 'SEA%'");
    expect(sql).toContain("LIKE 'MIX%'");
    expect(sql).not.toContain('vessel_loading_ports');
  });

  it('buildMissingEtaAlertUnitsSql uses the header bell cargo readiness window', () => {
    const { text } = buildMissingEtaAlertUnitsSql('', [], 50);
    expect(text).toContain(
      `INTERVAL '${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days'`,
    );
    expect(MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS).toBe(14);
  });

  it('buildMissingEtaAlertUnitsSql unions sea shipment, sea contract, land trucking, land contract units', () => {
    const { text, values } = buildMissingEtaAlertUnitsSql('', [], 50);
    expect(text).toContain('sea_shipment_units');
    expect(text).toContain('sea_contract_units');
    expect(text).toContain('land_trucking_units');
    expect(text).toContain('land_contract_units');
    expect(text).toContain('UNION ALL');
    expect(text).toContain('total_count');
    expect(values).toEqual([50]);
  });

  it('buildMissingEtaAlertUnitsSql applies scope clause and params to candidates', () => {
    const { text, values } = buildMissingEtaAlertUnitsSql(
      ' AND TRIM(COALESCE(c.product::text, \'\')) = ANY($1::text[])',
      [['CPO']],
      25,
    );
    expect(text).toContain('= ANY($1::text[])');
    expect(values).toEqual([['CPO'], 25]);
  });

  it('per-shipment units require all five loading ETA columns null on the shipment row', () => {
    const { text } = buildMissingEtaAlertUnitsSql('', [], 50);
    expect(text).toContain('s.eta_arrival IS NULL');
    expect(text).toContain('s.eta_sailed IS NULL');
  });

  it('per-trucking units exclude CANCELLED operations', () => {
    const { text } = buildMissingEtaAlertUnitsSql('', [], 50);
    expect(text).toContain("COALESCE(t.status, '') <> 'CANCELLED'");
  });
});
