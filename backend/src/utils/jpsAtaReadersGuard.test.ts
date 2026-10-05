import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildShipmentListAtaSelectSql,
  sqlEffectiveAtaArrivalDischarge,
  sqlEffectiveAtaBerthedDischarge,
  sqlEffectiveAtaCompleteDischarge,
  sqlEffectiveAtaStartDischarge,
  sqlJpsAtaWhileOpen,
} from './shipmentAtaOverrideSql';
import { sqlJpsAtaJsonExpr } from '../jps/scheduleAtaSql';

/**
 * Discharge ATA is read JPS -> KLIP -> SAP while a shipment is open. "One rule with two spellings" is how the pages have
 * drifted apart before, so this test finds every spelling of the effective discharge ATA in the source and fails when one
 * does not put the JPS lane first.
 */
const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['migrations', 'scripts', 'node_modules', 'dist'].includes(entry.name)) continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * eligibility.ts decides whether an STO is still owed an instruction: it asks "has ANY discharge ATA been recorded",
 * and must keep answering from KLIP and SAP alone. Once JPS has reported a time the STO has been sent anyway.
 */
const NOT_JPS_FIRST_ON_PURPOSE = new Set(['jps/eligibility.ts']);

describe('every effective discharge ATA puts the JPS lane first', () => {
  const files = sourceFiles(SRC).map((f) => ({ rel: path.relative(SRC, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));

  it('no COALESCE(sao.ata_discharge_*, ...) is left without it', () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      if (NOT_JPS_FIRST_ON_PURPOSE.has(rel)) continue;
      const bare = text.match(/COALESCE\(\s*sao\.ata_discharge_(?:arrival|berthed|start|complete)\b/g);
      if (bare) offenders.push(`${rel}: ${bare.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the contract-level ATC spellings (sao_atc / sao_f) carry it on the line above', () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/\bsao_\w+\.ata_discharge_complete::date,/.test(line) && !/sqlJpsAtaWhileOpen/.test(lines[i - 1] ?? '')) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the canonical helpers read JPS first, only while the shipment is not COMPLETED', () => {
    const open = (col: string) => `CASE WHEN s.status IS DISTINCT FROM 'COMPLETED' THEN sao.${col} END`;
    expect(sqlJpsAtaWhileOpen('jps_ata_discharge_complete')).toBe(open('jps_ata_discharge_complete'));
    expect(sqlEffectiveAtaArrivalDischarge()).toMatch(new RegExp(`^COALESCE\\(${escape(open('jps_ata_discharge_arrival'))}, sao\\.ata_discharge_arrival,`));
    expect(sqlEffectiveAtaBerthedDischarge()).toMatch(new RegExp(`^COALESCE\\(${escape(open('jps_ata_discharge_berthed'))}, sao\\.ata_discharge_berthed,`));
    expect(sqlEffectiveAtaStartDischarge()).toMatch(new RegExp(`^COALESCE\\(${escape(open('jps_ata_discharge_start'))}, sao\\.ata_discharge_start,`));
    expect(sqlEffectiveAtaCompleteDischarge()).toMatch(new RegExp(`^COALESCE\\(${escape(open('jps_ata_discharge_complete'))}, sao\\.ata_discharge_complete,`));
  });

  it('honours the alias of the shipment table it is given', () => {
    expect(sqlEffectiveAtaCompleteDischarge('s2', 'v')).toContain("s2.status IS DISTINCT FROM 'COMPLETED'");
    expect(sqlJpsAtaWhileOpen('jps_ata_discharge_start', 'sao_f', 's_f')).toBe(
      "CASE WHEN s_f.status IS DISTINCT FROM 'COMPLETED' THEN sao_f.jps_ata_discharge_start END",
    );
  });

  it('the shipment list select carries it on all four discharge milestones', () => {
    const select = buildShipmentListAtaSelectSql();
    for (const col of ['arrival', 'berthed', 'start', 'complete']) {
      expect(select).toContain(`sao.jps_ata_discharge_${col} END, sao.ata_discharge_`);
    }
  });

  it('the KLIP and SAP lanes after it keep their order: override, then the stored value', () => {
    const atc = sqlEffectiveAtaCompleteDischarge();
    expect(atc.indexOf('jps_ata_discharge_complete')).toBeLessThan(atc.indexOf('sao.ata_discharge_complete,'));
    expect(atc.indexOf('sao.ata_discharge_complete,')).toBeLessThan(atc.indexOf('s.ata_discharge_complete'));
  });
});

describe("the modal's JPS reference follows the same mapping", () => {
  it('reads ATA at DP, ATB, ATS and ATC from ta, tb, cargo_ops_start_at and cargo_ops_end_at, in WIB', () => {
    const expr = sqlJpsAtaJsonExpr('jps');
    expect(expr).toContain("'ata_vessel_arrive_at_discharge_port', ((jps.schedule_ta AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(expr).toContain("'ata_vessel_berthed_at_discharge_port', ((jps.schedule_tb AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(expr).toContain("'ata_vessel_start_discharging', ((jps.schedule_cargo_ops_start_at AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(expr).toContain("'ata_vessel_complete_discharge', ((jps.schedule_cargo_ops_end_at AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(expr).not.toContain('schedule_tc');
    expect(expr).not.toContain('schedule_sailed_at');
    expect(expr).not.toContain('schedule_cast_off_at');
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
