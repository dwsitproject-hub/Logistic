import { Request, Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

const TABLE = 'suppliers';

type ProductConfig = {
  product_name: string;
  percent_produce: number | null;
  working_hours_per_day: number | null;
  working_days_per_month: number | null;
  working_days_per_year: number | null;
};

const loadProductConfigs = async (): Promise<Record<string, ProductConfig>> => {
  const map: Record<string, ProductConfig> = {};
  try {
    const res = await query(
      `SELECT product_name, percent_produce, working_hours_per_day, working_days_per_month, working_days_per_year FROM products WHERE product_name IN ('CPO','PK','POME','SHELL')`
    );
    for (const row of res.rows as ProductConfig[]) {
      map[row.product_name.toUpperCase()] = row;
    }
  } catch (e) {
    logger.error('Failed to load product configs', e);
  }
  return map;
};

const computeEstimates = (
  capValue: any,
  productMap: Record<string, ProductConfig>
): {
  cpo_month: number | null;
  pk_month: number | null;
  pome_month: number | null;
  shell_month: number | null;
  cpo_year: number | null;
  pk_year: number | null;
  pome_year: number | null;
  shell_year: number | null;
} => {
  const cap = typeof capValue === 'number' ? capValue : parseFloat(capValue);
  if (!isFinite(cap)) {
    return { cpo_month: null, pk_month: null, pome_month: null, shell_month: null, cpo_year: null, pk_year: null, pome_year: null, shell_year: null };
  }

  const calc = (prod?: ProductConfig | null, useYear = false): number | null => {
    if (!prod) return null;
    const pct = prod.percent_produce == null ? null : Number(prod.percent_produce) / 100;
    const hours = prod.working_hours_per_day == null ? null : Number(prod.working_hours_per_day);
    const days = useYear
      ? prod.working_days_per_year == null ? null : Number(prod.working_days_per_year)
      : prod.working_days_per_month == null ? null : Number(prod.working_days_per_month);
    if (pct == null || hours == null || days == null) return null;
    return cap * pct * hours * days;
  };

  const cpoCfg = productMap['CPO'];
  const pkCfg = productMap['PK'];
  const pomeCfg = productMap['POME'];
  const shellCfg = productMap['SHELL'];

  return {
    cpo_month: calc(cpoCfg, false),
    pk_month: calc(pkCfg, false),
    pome_month: calc(pomeCfg, false),
    shell_month: calc(shellCfg, false),
    cpo_year: calc(cpoCfg, true),
    pk_year: calc(pkCfg, true),
    pome_year: calc(pomeCfg, true),
    shell_year: calc(shellCfg, true),
  };
};

export const listSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', search = '' } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 5000);
    const offset = (pageNum - 1) * limitNum;

    const where: string[] = [];
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push('(plant_code ILIKE $' + params.length + ' OR mills ILIKE $' + params.length + ' OR mill_code ILIKE $' + params.length + ' OR group_id ILIKE $' + params.length + ' OR island ILIKE $' + params.length + ' OR province ILIKE $' + params.length + ')');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const dataSql = `SELECT * FROM ${TABLE} ${whereSql} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countSql = `SELECT COUNT(*)::int AS count FROM ${TABLE} ${whereSql}`;

    const dataRes = await query(dataSql, [...params, limitNum, offset]);
    const countRes = await query(countSql, params);

    return res.json({ success: true, data: { items: dataRes.rows, total: countRes.rows[0].count, page: pageNum, limit: limitNum } });
  } catch (error) {
    logger.error('Error listing suppliers:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to list suppliers' } });
  }
};

export const getSupplierById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { message: 'Supplier not found' } });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error fetching supplier:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch supplier' } });
  }
};

export const createSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const {
      plant_code, mills, group_id, parent_company, group_holding,
      controlling_shareholder, other_shareholders,
      prov_code, prov_no, mill_no, mill_code,
      group_type, group_scale, integrated_status, cap,
      city_regency, province, island, longitude, latitude,
      kml_folder, map, rspo, rspo_type, ispo, iscc, ggl,
      year_commence, updated_date, update_year, remarks,
    } = req.body;

    const normalizeNum = (v: any) => (v === '' || v === undefined ? null : Number(v));
    const normalizeStr = (v: any) => (v === '' || v === undefined ? null : v);

    const productMap = await loadProductConfigs();
    const est = computeEstimates(cap, productMap);

    const insertSql = `
      INSERT INTO ${TABLE} (
        plant_code, mills, group_id, parent_company, group_holding, controlling_shareholder, other_shareholders,
        prov_code, prov_no, mill_no, mill_code,
        group_type, group_scale, integrated_status, cap,
        cpo_prod_est_month, pk_prod_est_month, pome_prod_est_month, shell_prod_est_month,
        cpo_prod_est_year, pk_prod_est_year, pome_prod_est_year, shell_prod_est_year,
        city_regency, province, island, longitude, latitude, kml_folder, map,
        rspo, rspo_type, ispo, iscc, ggl,
        year_commence, updated_date, update_year, remarks
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
        $36,$37,$38,$39
      ) RETURNING *
    `;

    const params = [
      normalizeStr(plant_code), normalizeStr(mills), normalizeStr(group_id),
      normalizeStr(parent_company), normalizeStr(group_holding),
      normalizeStr(controlling_shareholder), normalizeStr(other_shareholders),
      normalizeStr(prov_code), normalizeStr(prov_no), normalizeStr(mill_no), normalizeStr(mill_code),
      normalizeStr(group_type), normalizeStr(group_scale), normalizeStr(integrated_status), normalizeNum(cap),
      est.cpo_month, est.pk_month, est.pome_month, est.shell_month,
      est.cpo_year, est.pk_year, est.pome_year, est.shell_year,
      normalizeStr(city_regency), normalizeStr(province), normalizeStr(island),
      normalizeNum(longitude), normalizeNum(latitude), normalizeStr(kml_folder), normalizeStr(map),
      normalizeStr(rspo), normalizeStr(rspo_type), normalizeStr(ispo), normalizeStr(iscc), normalizeStr(ggl),
      normalizeNum(year_commence), normalizeStr(updated_date), normalizeNum(update_year), normalizeStr(remarks),
    ];

    const result = await query(insertSql, params);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error('Error creating supplier:', error);
    const message = error?.code === '23505' ? 'Supplier with this plant_code already exists' : 'Failed to create supplier';
    return res.status(500).json({ success: false, error: { message } });
  }
};

export const updateSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const fields = [
      'plant_code','mills','group_id','parent_company','group_holding','controlling_shareholder','other_shareholders',
      'prov_code','prov_no','mill_no','mill_code',
      'group_type','group_scale','integrated_status','cap',
      'cpo_prod_est_month','pk_prod_est_month','pome_prod_est_month','shell_prod_est_month',
      'cpo_prod_est_year','pk_prod_est_year','pome_prod_est_year','shell_prod_est_year',
      'city_regency','province','island','longitude','latitude','kml_folder','map',
      'rspo','rspo_type','ispo','iscc','ggl',
      'year_commence','updated_date','update_year','remarks'
    ];

    const setClauses: string[] = [];
    const params: any[] = [];
    const numericFields = new Set([
      'cap','longitude','latitude','year_commence','update_year',
      'cpo_prod_est_month','pk_prod_est_month','pome_prod_est_month','shell_prod_est_month',
      'cpo_prod_est_year','pk_prod_est_year','pome_prod_est_year','shell_prod_est_year'
    ]);
    const estimateFields = new Set([
      'cpo_prod_est_month','pk_prod_est_month','pome_prod_est_month','shell_prod_est_month',
      'cpo_prod_est_year','pk_prod_est_year','pome_prod_est_year','shell_prod_est_year'
    ]);
    fields.forEach((f) => {
      if (f in req.body) {
        // If CAP is present we will recompute estimate fields; avoid assigning them twice
        if ('cap' in req.body && estimateFields.has(f)) {
          return;
        }
        let val = (req.body as any)[f];
        if (val === '') val = null;
        if (numericFields.has(f) && val !== null && val !== undefined) val = Number(val);
        params.push(val);
        setClauses.push(`${f} = $${params.length}`);
      }
    });

    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'No fields to update' } });
    }

    // If CAP provided or any estimates missing, recompute estimates from products
    if ('cap' in req.body) {
      const productMap = await loadProductConfigs();
      const est = computeEstimates((req.body as any)['cap'], productMap);
      const toSet: Record<string, number | null> = {
        cpo_prod_est_month: est.cpo_month,
        pk_prod_est_month: est.pk_month,
        pome_prod_est_month: est.pome_month,
        shell_prod_est_month: est.shell_month,
        cpo_prod_est_year: est.cpo_year,
        pk_prod_est_year: est.pk_year,
        pome_prod_est_year: est.pome_year,
        shell_prod_est_year: est.shell_year,
      };
      Object.entries(toSet).forEach(([k, v]) => {
        params.push(v);
        setClauses.push(`${k} = $${params.length}`);
      });
    }

    // updated_at timestamp
    const sql = `UPDATE ${TABLE} SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);
    const result = await query(sql, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { message: 'Supplier not found' } });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error updating supplier:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to update supplier' } });
  }
};

export const deleteSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { message: 'Supplier not found' } });
    }
    return res.json({ success: true, data: { id } });
  } catch (error) {
    logger.error('Error deleting supplier:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to delete supplier' } });
  }
};

export const importSuppliersFromExcel = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file?.path) {
      return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
    }

    const workbook = XLSX.readFile(file.path, { raw: false, dense: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (rows.length < 2) {
      return res.status(400).json({ success: false, error: { message: 'File must have header and at least one data row' } });
    }

    // Find the header row: look for the row containing "PLANT CODE"
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (rows[i].some((c) => String(c ?? '').trim().toUpperCase() === 'PLANT CODE')) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) {
      return res.status(400).json({ success: false, error: { message: 'Cannot find header row with PLANT CODE column' } });
    }

    // Normalize header values (collapse whitespace/newlines)
    const headerRow = rows[headerRowIdx].map((h) =>
      String(h ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    );

    // Column position map — fixed positions per the standard file format
    // Duplicate "Prod Est" headers are disambiguated by position (month first, then year)
    const colPos = {
      // "PLANT CODE" col in file is a category ("MILL"), not a unique ID.
      // The actual unique identifier is "MILL CODE" (e.g. "ACEH/MILL - 0001").
      plant_code: headerRow.findIndex((h) => h.toUpperCase() === 'MILL CODE'),
      mill_code:  headerRow.findIndex((h) => h.toUpperCase() === 'MILL CODE'),
      mills:      headerRow.findIndex((h) => h.toUpperCase() === 'MILLS'),
      group_id:   headerRow.findIndex((h) => h.toUpperCase() === 'GROUP ID'),
      group_type: headerRow.findIndex((h) => h.toUpperCase() === 'GROUP TYPE'),
      group_scale: headerRow.findIndex((h) => h.toUpperCase() === 'GROUP SCALE'),
      integrated_status: headerRow.findIndex((h) => h.toUpperCase() === 'INTEGRATED STATUS'),
      cap: headerRow.findIndex((h) => /^CAP/.test(h.toUpperCase())),
      // CPO/PK/POME/SHELL Prod Est appear twice — first = month, second = year
      ...(() => {
        const normalize = (s: string) => s.replace(/[\r\n\s]+/g, ' ').trim().toUpperCase();
        const allIdxs = (prefix: string) =>
          headerRow.reduce((acc, h, i) => {
            const n = normalize(h);
            if (n.startsWith(prefix) && n.includes('PROD EST')) acc.push(i);
            return acc;
          }, [] as number[]);
        const cpo  = allIdxs('CPO');
        const pk   = allIdxs('PK');
        const pome = allIdxs('POME');
        const shel = allIdxs('SHELL');
        return {
          cpo_prod_est_month:   cpo[0]  ?? -1,
          pk_prod_est_month:    pk[0]   ?? -1,
          pome_prod_est_month:  pome[0] ?? -1,
          shell_prod_est_month: shel[0] ?? -1,
          cpo_prod_est_year:    cpo[1]  ?? -1,
          pk_prod_est_year:     pk[1]   ?? -1,
          pome_prod_est_year:   pome[1] ?? -1,
          shell_prod_est_year:  shel[1] ?? -1,
        };
      })(),
      city_regency:  headerRow.findIndex((h) => h.toUpperCase() === 'CITY / REGENCY'),
      province:      headerRow.findIndex((h) => h.toUpperCase() === 'PROVINCE'),
      island:        headerRow.findIndex((h) => h.toUpperCase() === 'ISLAND'),
      longitude:     headerRow.findIndex((h) => /^(LONGITUDE|LONG\.)$/i.test(h)),
      latitude:      headerRow.findIndex((h) => /^(LATITUDE|LAT\.)$/i.test(h)),
      kml_folder:    headerRow.findIndex((h) => h.toUpperCase() === 'KML_FOLDER'),
      map:           headerRow.findIndex((h) => /^(GOOGLE MAPS?|MAP)$/i.test(h)),
      rspo:          headerRow.findIndex((h) => h.toUpperCase() === 'RSPO'),
      rspo_type:     headerRow.findIndex((h) => h.toUpperCase() === 'RSPO TYPE'),
      ispo:          headerRow.findIndex((h) => h.toUpperCase() === 'ISPO'),
      iscc:          headerRow.findIndex((h) => h.toUpperCase() === 'ISCC'),
      ggl:           headerRow.findIndex((h) => h.toUpperCase() === 'GGL'),
      year_commence: headerRow.findIndex((h) => h.toUpperCase() === 'YEAR COMMENCE'),
      updated_date:  headerRow.findIndex((h) => h.toUpperCase() === 'UPDATE DATE' || h.toUpperCase() === 'UPDATED DATE'),
      update_year:   headerRow.findIndex((h) => h.toUpperCase() === 'UPDATE YEAR'),
      remarks:       headerRow.findIndex((h) => h.toUpperCase() === 'REMARKS'),
    };

    if (colPos.plant_code === -1) {
      return res.status(400).json({ success: false, error: { message: 'PLANT CODE column not found in header row' } });
    }

    const parseNum = (v: any): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
      return isFinite(n) ? n : null;
    };
    const parseStr = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s === '' ? null : s;
    };
    // Excel stores dates as serial numbers (days since 1900-01-00).
    // Convert to YYYY-MM-DD string; also handles JS Date objects and plain strings.
    const parseDate = (v: any): string | null => {
      if (v === null || v === undefined || v === '') return null;
      if (v instanceof Date) {
        if (isNaN(v.getTime())) return null;
        return v.toISOString().substring(0, 10);
      }
      if (typeof v === 'number' && isFinite(v)) {
        // Excel serial date → JS Date (subtract 25569 days to reach Unix epoch)
        const ms = Math.round((v - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().substring(0, 10);
      }
      const s = String(v).trim();
      if (s === '') return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toISOString().substring(0, 10);
    };

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    // Data rows start 3 rows after header (skip widths row + sub-header row + header itself)
    const dataStartIdx = headerRowIdx + 3;

    for (let r = dataStartIdx; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => c === null || c === '')) continue;

      const g = (col: number) => col >= 0 ? row[col] : null;

      const plant_code = parseStr(g(colPos.plant_code));
      // Skip footer/summary rows that have no MILL CODE
      if (!plant_code) continue;

      const payload = {
        plant_code,
        mill_code:   plant_code, // same as plant_code (both from MILL CODE column)
        mills:       parseStr(g(colPos.mills)),
        group_id:    parseStr(g(colPos.group_id)),
        group_type:  parseStr(g(colPos.group_type)),
        group_scale: parseStr(g(colPos.group_scale)),
        integrated_status: parseStr(g(colPos.integrated_status)),
        cap:         parseNum(g(colPos.cap)),
        cpo_prod_est_month:   parseNum(g(colPos.cpo_prod_est_month)),
        pk_prod_est_month:    parseNum(g(colPos.pk_prod_est_month)),
        pome_prod_est_month:  parseNum(g(colPos.pome_prod_est_month)),
        shell_prod_est_month: parseNum(g(colPos.shell_prod_est_month)),
        cpo_prod_est_year:    parseNum(g(colPos.cpo_prod_est_year)),
        pk_prod_est_year:     parseNum(g(colPos.pk_prod_est_year)),
        pome_prod_est_year:   parseNum(g(colPos.pome_prod_est_year)),
        shell_prod_est_year:  parseNum(g(colPos.shell_prod_est_year)),
        city_regency: parseStr(g(colPos.city_regency)),
        province:     parseStr(g(colPos.province)),
        island:       parseStr(g(colPos.island)),
        longitude:    parseNum(g(colPos.longitude)),
        latitude:     parseNum(g(colPos.latitude)),
        kml_folder:   parseStr(g(colPos.kml_folder)),
        map:          parseStr(g(colPos.map)),
        rspo:         parseStr(g(colPos.rspo)),
        rspo_type:    parseStr(g(colPos.rspo_type)),
        ispo:         parseStr(g(colPos.ispo)),
        iscc:         parseStr(g(colPos.iscc)),
        ggl:          parseStr(g(colPos.ggl)),
        year_commence: parseNum(g(colPos.year_commence)),
        updated_date: parseDate(g(colPos.updated_date)),
        update_year:  parseNum(g(colPos.update_year)),
        remarks:      parseStr(g(colPos.remarks)),
      };

      try {
        // Upsert keyed on plant_code (unique constraint)
        const checkRes = await query(`SELECT id FROM ${TABLE} WHERE plant_code = $1 LIMIT 1`, [plant_code]);

        if ((checkRes.rowCount ?? 0) > 0) {
          const id = checkRes.rows[0].id as string;
          await query(
            `UPDATE ${TABLE} SET
              mill_code=$1,
              mills=$2, group_id=$3, group_type=$4, group_scale=$5, integrated_status=$6, cap=$7,
              cpo_prod_est_month=$8, pk_prod_est_month=$9, pome_prod_est_month=$10, shell_prod_est_month=$11,
              cpo_prod_est_year=$12, pk_prod_est_year=$13, pome_prod_est_year=$14, shell_prod_est_year=$15,
              city_regency=$16, province=$17, island=$18, longitude=$19, latitude=$20, kml_folder=$21, map=$22,
              rspo=$23, rspo_type=$24, ispo=$25, iscc=$26, ggl=$27,
              year_commence=$28, updated_date=$29, update_year=$30, remarks=$31,
              updated_at=NOW()
            WHERE id=$32`,
            [
              payload.mill_code,
              payload.mills, payload.group_id, payload.group_type, payload.group_scale, payload.integrated_status, payload.cap,
              payload.cpo_prod_est_month, payload.pk_prod_est_month, payload.pome_prod_est_month, payload.shell_prod_est_month,
              payload.cpo_prod_est_year, payload.pk_prod_est_year, payload.pome_prod_est_year, payload.shell_prod_est_year,
              payload.city_regency, payload.province, payload.island, payload.longitude, payload.latitude, payload.kml_folder, payload.map,
              payload.rspo, payload.rspo_type, payload.ispo, payload.iscc, payload.ggl,
              payload.year_commence, payload.updated_date, payload.update_year, payload.remarks,
              id,
            ]
          );
          updated += 1;
        } else {
          await query(
            `INSERT INTO ${TABLE} (
              plant_code, mill_code,
              mills, group_id, group_type, group_scale, integrated_status, cap,
              cpo_prod_est_month, pk_prod_est_month, pome_prod_est_month, shell_prod_est_month,
              cpo_prod_est_year, pk_prod_est_year, pome_prod_est_year, shell_prod_est_year,
              city_regency, province, island, longitude, latitude, kml_folder, map,
              rspo, rspo_type, ispo, iscc, ggl,
              year_commence, updated_date, update_year, remarks
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
            )`,
            [
              payload.plant_code, payload.mill_code,
              payload.mills, payload.group_id, payload.group_type, payload.group_scale, payload.integrated_status, payload.cap,
              payload.cpo_prod_est_month, payload.pk_prod_est_month, payload.pome_prod_est_month, payload.shell_prod_est_month,
              payload.cpo_prod_est_year, payload.pk_prod_est_year, payload.pome_prod_est_year, payload.shell_prod_est_year,
              payload.city_regency, payload.province, payload.island, payload.longitude, payload.latitude, payload.kml_folder, payload.map,
              payload.rspo, payload.rspo_type, payload.ispo, payload.iscc, payload.ggl,
              payload.year_commence, payload.updated_date, payload.update_year, payload.remarks,
            ]
          );
          inserted += 1;
        }
      } catch (e: any) {
        logger.error('Supplier import row error', { row: r + 1, error: e?.message });
        errors.push(`Row ${r + 1}: ${e?.message || 'Unknown error'}`);
      }
    }

    return res.json({ success: true, data: { inserted, updated, errors } });
  } catch (error) {
    logger.error('Error importing suppliers:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to import suppliers' } });
  }
};


// Aggregates
export const getTotalsByIsland = async (_req: AuthRequest, res: Response) => {
  try {
    const sql = `
      SELECT
        COALESCE(island, 'UNKNOWN') AS island,
        COALESCE(SUM(cpo_prod_est_month), 0) AS cpo_month,
        COALESCE(SUM(pk_prod_est_month), 0) AS pk_month,
        COALESCE(SUM(pome_prod_est_month), 0) AS pome_month,
        COALESCE(SUM(shell_prod_est_month), 0) AS shell_month,
        COALESCE(SUM(cpo_prod_est_year), 0) AS cpo_year,
        COALESCE(SUM(pk_prod_est_year), 0) AS pk_year,
        COALESCE(SUM(pome_prod_est_year), 0) AS pome_year,
        COALESCE(SUM(shell_prod_est_year), 0) AS shell_year
      FROM ${TABLE}
      GROUP BY COALESCE(island, 'UNKNOWN')
      ORDER BY island
    `;
    const result = await query(sql);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error aggregating suppliers by island:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load aggregates' } });
  }
};

export const getTotalsByProvince = async (_req: AuthRequest, res: Response) => {
  try {
    const sql = `
      SELECT
        COALESCE(province, 'UNKNOWN') AS province,
        COALESCE(SUM(cpo_prod_est_month), 0) AS cpo_month,
        COALESCE(SUM(pk_prod_est_month), 0) AS pk_month,
        COALESCE(SUM(pome_prod_est_month), 0) AS pome_month,
        COALESCE(SUM(shell_prod_est_month), 0) AS shell_month,
        COALESCE(SUM(cpo_prod_est_year), 0) AS cpo_year,
        COALESCE(SUM(pk_prod_est_year), 0) AS pk_year,
        COALESCE(SUM(pome_prod_est_year), 0) AS pome_year,
        COALESCE(SUM(shell_prod_est_year), 0) AS shell_year
      FROM ${TABLE}
      GROUP BY COALESCE(province, 'UNKNOWN')
      ORDER BY province
    `;
    const result = await query(sql);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error aggregating suppliers by province:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load aggregates' } });
  }
};

export const getTotalsByParentCompany = async (_req: AuthRequest, res: Response) => {
  try {
    const sql = `
      SELECT
        COALESCE(parent_company, 'UNKNOWN') AS parent_company,
        COALESCE(SUM(cpo_prod_est_month), 0) AS cpo_month,
        COALESCE(SUM(pk_prod_est_month), 0) AS pk_month,
        COALESCE(SUM(pome_prod_est_month), 0) AS pome_month,
        COALESCE(SUM(shell_prod_est_month), 0) AS shell_month,
        COALESCE(SUM(cpo_prod_est_year), 0) AS cpo_year,
        COALESCE(SUM(pk_prod_est_year), 0) AS pk_year,
        COALESCE(SUM(pome_prod_est_year), 0) AS pome_year,
        COALESCE(SUM(shell_prod_est_year), 0) AS shell_year
      FROM ${TABLE}
      GROUP BY COALESCE(parent_company, 'UNKNOWN')
      ORDER BY parent_company
    `;
    const result = await query(sql);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error aggregating suppliers by parent company:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load aggregates' } });
  }
};


