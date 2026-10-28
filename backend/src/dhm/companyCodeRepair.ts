/**
 * Master Company (Internal): bring KLIP's SAP Company Code (`company_code`) in line with DHM's `company_code_sap`, as a plan first and as an UPDATE only when asked.
 *
 * Why it is needed. KLIP's company_code is the SAP Company Code (unique, and the key contracts use). DHM used to carry that code as the organisation's short_name, and KLIP
 * created its own SAP-coded organisations there (ORG-0016 "PMC GENERAL HO JAKARTA", short_name "PM", ...). DHM has since added the legal entities (ORG-0006 "PT Prima Makmur
 * Cakrawala", short_name "PMC") with the SAP code in a field of its own, company_code_sap ("PM"). The DHM sync copied short_name, so KLIP held the legal entity as "PMC" and the
 * legacy organisation as "PM", and the SAP code "PM" resolved to an organisation JPS does not know. The sync now reads company_code_sap (applyCompany); this repairs the rows that
 * were written before it.
 *
 * What a repair does, for every organisation with a company_code_sap that differs from its row's company_code: the row that currently holds that code (the legacy one) is RELEASED
 * to its own DHM code (ORG-0016: always unique, and says where it came from), and the organisation's row takes the SAP code. Nothing is deleted; plants and sites are linked by
 * row id, so they stay where they are; contracts show the SAP Buyer text, not this table. Every step names the old value, so it can be undone.
 *
 * Pure planning is kept apart from the write so the rules can be tested without a database.
 */
export interface CompanyRow {
  id: string;
  company_code: string;
  company_name: string;
  code_dhm: string | null;
  code_klip: string | null;
  dhm_is_deleted: boolean;
  /** dhm_payload.company_code_sap */
  sap: string | null;
}

export interface CodeStep {
  id: string;
  name: string;
  from: string;
  to: string;
  why: 'release legacy row' | 'take SAP code';
}

export interface RepairConflict {
  code: string;
  reason: string;
}

export interface RepairPlan {
  steps: CodeStep[];
  conflicts: RepairConflict[];
  /** Organisations whose row already holds its SAP code. */
  alreadyRight: string[];
}

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

export function planCompanyCodeRepair(rows: CompanyRow[]): RepairPlan {
  const steps: CodeStep[] = [];
  const conflicts: RepairConflict[] = [];
  const alreadyRight: string[] = [];

  const byCode = new Map<string, CompanyRow>();
  for (const r of rows) byCode.set(norm(r.company_code), r);

  // Who claims which SAP code: a live organisation DHM gives a company_code_sap.
  const claims = new Map<string, CompanyRow[]>();
  for (const r of rows) {
    const code = norm(r.sap);
    if (!code || !r.code_dhm || r.dhm_is_deleted) continue;
    claims.set(code, [...(claims.get(code) ?? []), r]);
  }

  const taken = new Set(byCode.keys()); // codes in use after the steps planned so far

  for (const [target, claimants] of [...claims.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (claimants.length > 1) {
      conflicts.push({ code: target, reason: `${claimants.map((c) => c.code_dhm).join(' and ')} both claim SAP code ${target} in DHM: DHM has to settle it` });
      continue;
    }
    const org = claimants[0];
    if (norm(org.company_code) === target) {
      alreadyRight.push(target);
      continue;
    }

    const holder = byCode.get(target);
    const pending: CodeStep[] = [];
    if (holder && holder.id !== org.id) {
      const releaseTo = String(holder.code_dhm ?? '').trim() || String(holder.code_klip ?? '').trim();
      if (!releaseTo) {
        conflicts.push({ code: target, reason: `the row holding ${target} (${holder.company_name}) has neither a DHM code nor a KLIP code to be released to` });
        continue;
      }
      if (norm(releaseTo) !== norm(holder.company_code) && taken.has(norm(releaseTo))) {
        conflicts.push({ code: target, reason: `${holder.company_name} would be released to ${releaseTo}, which another row already holds` });
        continue;
      }
      pending.push({ id: holder.id, name: holder.company_name, from: holder.company_code, to: releaseTo, why: 'release legacy row' });
      taken.add(norm(releaseTo));
    }
    pending.push({ id: org.id, name: org.company_name, from: org.company_code, to: target, why: 'take SAP code' });
    taken.add(target);
    steps.push(...pending);
  }

  return { steps, conflicts, alreadyRight };
}

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

export async function loadCompanyRows(client: Client): Promise<CompanyRow[]> {
  const res = await client.query(
    `SELECT id::text AS id, company_code, company_name, code_dhm, code_klip, COALESCE(dhm_is_deleted, FALSE) AS dhm_is_deleted,
            NULLIF(TRIM(dhm_payload->>'company_code_sap'), '') AS sap
       FROM master_companies`,
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    company_code: String(r.company_code ?? ''),
    company_name: String(r.company_name ?? ''),
    code_dhm: r.code_dhm == null ? null : String(r.code_dhm),
    code_klip: r.code_klip == null ? null : String(r.code_klip),
    dhm_is_deleted: Boolean(r.dhm_is_deleted),
    sap: r.sap == null ? null : String(r.sap),
  }));
}

/** SQL that puts every step back (the old value is named in each, and the UPDATE only fires on the value it set). */
export function rollbackSql(steps: CodeStep[]): string[] {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  return [...steps]
    .reverse()
    .map((s) => `UPDATE master_companies SET company_code = ${q(s.from)}, updated_at = CURRENT_TIMESTAMP WHERE id = '${s.id}' AND company_code = ${q(s.to)};`);
}

/**
 * Run the steps in order inside ONE transaction on the given connection: the legacy row is released before the organisation takes the code, because company_code is unique.
 * A step that does not find its row with the value the plan saw (someone changed it in between) rolls the whole repair back.
 */
export async function applyCompanyCodeRepair(client: Client, steps: CodeStep[]): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const s of steps) {
      const r = await client.query(
        `UPDATE master_companies SET company_code = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND company_code = $3`,
        [s.id, s.to, s.from],
      );
      if (r.rowCount !== 1) throw new Error(`${s.name}: expected to change ${s.from} -> ${s.to}, but the row is not as it was planned (${r.rowCount ?? 0} rows)`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
