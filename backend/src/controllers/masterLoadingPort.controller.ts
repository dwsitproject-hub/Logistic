import { Response } from 'express';
import { pushMasterPortToDhm } from '../dhm';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { NON_NUMERIC_PORT_NAME_FILTER } from '../utils/portDisplaySql';

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

async function resolvePortSite(
  siteId: unknown,
  siteCodeText: unknown,
): Promise<{ siteId: string | null; siteCode: string | null }> {
  const id = String(siteId ?? '').trim();
  if (id) {
    const matched = await query(
      `SELECT id::text AS id, code_dhm FROM master_sites WHERE id = $1::uuid`,
      [id],
    );
    if (!matched.rows[0]) return { siteId: null, siteCode: null };
    return {
      siteId: String(matched.rows[0].id),
      siteCode: String(matched.rows[0].code_dhm || '').trim() || null,
    };
  }
  const text = String(siteCodeText ?? '').trim();
  if (!text) return { siteId: null, siteCode: null };
  const matched = await query(
    `SELECT id::text AS id, code_dhm
     FROM master_sites
     WHERE code_dhm IS NOT NULL
       AND (
         upper(trim(code_dhm)) = upper(trim($1))
         OR upper(trim(site_name)) = upper(trim($1))
       )
     ORDER BY CASE WHEN upper(trim(code_dhm)) = upper(trim($1)) THEN 0 ELSE 1 END
     LIMIT 1`,
    [text],
  );
  const code = String(matched.rows[0]?.code_dhm || '').trim();
  if (code) return { siteId: matched.rows[0]?.id ? String(matched.rows[0].id) : null, siteCode: code };
  const named = await query(
    `SELECT id::text AS id FROM master_sites WHERE upper(trim(site_name)) = upper(trim($1)) LIMIT 1`,
    [text],
  );
  if (named.rows[0]) return { siteId: String(named.rows[0].id), siteCode: null };
  return { siteId: null, siteCode: text };
}

const NON_NUMERIC_PORT = NON_NUMERIC_PORT_NAME_FILTER('port');
const NON_NUMERIC_VLP = NON_NUMERIC_PORT_NAME_FILTER('vlp.port_name');
const NON_NUMERIC_SHIP = NON_NUMERIC_PORT_NAME_FILTER('s.port_of_loading::text');
const NON_NUMERIC_SAP = NON_NUMERIC_PORT_NAME_FILTER('sap.port_text');

export const listMasterLoadingPorts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50, masterOnly } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);
    const searchTerm = typeof search === 'string' ? search.trim() : '';
    const catalogOnly = String(masterOnly ?? '').toLowerCase() === 'true' || String(masterOnly ?? '') === '1';

    const params: any[] = [];
    let searchFilter = '';
    if (searchTerm.length > 0) {
      params.push(`%${searchTerm}%`);
      searchFilter = ` AND port ILIKE $${params.length}`;
    }

    const catalogSearch = searchTerm.length > 0
      ? `AND (p.port ILIKE $1 OR p.region ILIKE $1 OR p.code_klip ILIKE $1 OR p.code_dhm ILIKE $1 OR s.site_name ILIKE $1)`
      : '';
    const catalogListSql = `
      SELECT p.id::text AS id, p.port, p.region, p.code_klip, p.code_dhm, p.dhm_site_code,
             p.site_id::text AS site_id, s.site_name AS site
      FROM master_loading_ports p
      LEFT JOIN master_sites s ON s.id = p.site_id
      WHERE ${NON_NUMERIC_PORT_NAME_FILTER('p.port')}
        ${catalogSearch}
      ORDER BY p.port
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const catalogCountSql = `
      SELECT COUNT(*) AS count
      FROM master_loading_ports p
      LEFT JOIN master_sites s ON s.id = p.site_id
      WHERE ${NON_NUMERIC_PORT_NAME_FILTER('p.port')}
        ${catalogSearch}
    `;

    const listSql = catalogOnly ? catalogListSql : `
      WITH port_sources AS (
        SELECT id::text AS id, port, region, code_klip, code_dhm, dhm_site_code, 0 AS priority
        FROM master_loading_ports
        WHERE 1=1
          ${searchTerm.length > 0 ? `AND (port ILIKE $1 OR region ILIKE $1)` : ''}

        UNION ALL

        SELECT
          'vlp-' || vlp.port_name AS id,
          vlp.port_name AS port,
          NULL::varchar AS region,
          NULL::varchar AS code_klip,
          NULL::varchar AS code_dhm,
          NULL::varchar AS dhm_site_code,
          1 AS priority
        FROM vessel_loading_ports vlp
        WHERE vlp.is_discharge_port = false
          AND ${NON_NUMERIC_VLP}
          ${searchTerm.length > 0 ? `AND vlp.port_name ILIKE $1` : ''}

        UNION ALL

        SELECT
          'ship-' || s.port_of_loading AS id,
          s.port_of_loading::text AS port,
          NULL::varchar AS region,
          NULL::varchar AS code_klip,
          NULL::varchar AS code_dhm,
          NULL::varchar AS dhm_site_code,
          2 AS priority
        FROM shipments s
        WHERE ${NON_NUMERIC_SHIP}
          ${searchTerm.length > 0 ? `AND s.port_of_loading::text ILIKE $1` : ''}

        UNION ALL

        SELECT
          'sap-' || sap.port_text AS id,
          sap.port_text AS port,
          NULL::varchar AS region,
          NULL::varchar AS code_klip,
          NULL::varchar AS code_dhm,
          NULL::varchar AS dhm_site_code,
          3 AS priority
        FROM (
          SELECT DISTINCT NULLIF(TRIM(COALESCE(
            spd.data->'raw'->>'Vessel Loading Port 1',
            spd.data->'raw'->>'Port of Loading',
            spd.data->'shipment'->>'vessel_loading_port_1'
          )), '') AS port_text
          FROM sap_processed_data spd
        ) sap
        WHERE ${NON_NUMERIC_SAP}
          ${searchTerm.length > 0 ? `AND sap.port_text ILIKE $1` : ''}
      ),
      ranked AS (
        SELECT DISTINCT ON (port)
          id,
          port,
          region,
          code_klip,
          code_dhm,
          dhm_site_code,
          priority
        FROM port_sources
        ORDER BY port, priority
      )
      SELECT id, port, region, code_klip, code_dhm, dhm_site_code
      FROM ranked
      WHERE ${NON_NUMERIC_PORT}
        ${searchFilter}
      ORDER BY priority, port
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = catalogOnly ? catalogCountSql : `
      WITH port_sources AS (
        SELECT port, region, 0 AS priority
        FROM master_loading_ports
        WHERE 1=1
          ${searchTerm.length > 0 ? `AND (port ILIKE $1 OR region ILIKE $1)` : ''}

        UNION ALL

        SELECT vlp.port_name AS port, NULL::varchar AS region, 1 AS priority
        FROM vessel_loading_ports vlp
        WHERE vlp.is_discharge_port = false
          AND ${NON_NUMERIC_VLP}
          ${searchTerm.length > 0 ? `AND vlp.port_name ILIKE $1` : ''}

        UNION ALL

        SELECT s.port_of_loading::text AS port, NULL::varchar AS region, 2 AS priority
        FROM shipments s
        WHERE ${NON_NUMERIC_SHIP}
          ${searchTerm.length > 0 ? `AND s.port_of_loading::text ILIKE $1` : ''}

        UNION ALL

        SELECT sap.port_text AS port, NULL::varchar AS region, 3 AS priority
        FROM (
          SELECT DISTINCT NULLIF(TRIM(COALESCE(
            spd.data->'raw'->>'Vessel Loading Port 1',
            spd.data->'raw'->>'Port of Loading',
            spd.data->'shipment'->>'vessel_loading_port_1'
          )), '') AS port_text
          FROM sap_processed_data spd
        ) sap
        WHERE ${NON_NUMERIC_SAP}
          ${searchTerm.length > 0 ? `AND sap.port_text ILIKE $1` : ''}
      ),
      ranked AS (
        SELECT DISTINCT ON (port) port, region, priority
        FROM port_sources
        ORDER BY port, priority
      )
      SELECT COUNT(*) AS count
      FROM ranked
      WHERE ${NON_NUMERIC_PORT}
        ${searchFilter}
    `;

    const [listResult, countResult] = await Promise.all([
      query(listSql, [...params, Number(limit), offset]),
      query(countSql, params),
    ]);

    res.json({
      success: true,
      data: {
        items: listResult.rows,
        pagination: {
          total: parseInt(countResult.rows[0]?.count ?? '0', 10),
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error) {
    logger.error('List master loading ports error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master ports' } });
  }
};

export const createMasterLoadingPort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      region,
      port,
      coordinate,
      masuk_alur,
      lebar_alur,
      jumlah_jembatan,
      jenis_port,
      pemilik_port,
      antri_muat_hari,
      jumlah_demaraga,
      panjang_demaraga,
      draft,
      dwt,
      siklus_pasang,
      loading_method,
      loading_rate_mt_per_hour,
      shipper,
      dhm_site_code,
      site_id,
    } = req.body;

    const insertSql = `
      INSERT INTO master_loading_ports (
        region, port, coordinate, masuk_alur, lebar_alur, jumlah_jembatan,
        jenis_port, pemilik_port, antri_muat_hari, jumlah_demaraga, panjang_demaraga,
        draft, dwt, siklus_pasang, loading_method, loading_rate_mt_per_hour, shipper,
        dhm_site_code, site_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::uuid
      )
      RETURNING *
    `;
    const linked = await resolvePortSite(site_id, dhm_site_code);
    const result = await query(insertSql, [
      region ?? null,
      port,
      coordinate ?? null,
      masuk_alur ?? null,
      lebar_alur ?? null,
      jumlah_jembatan ?? null,
      jenis_port ?? null,
      pemilik_port ?? null,
      antri_muat_hari ?? null,
      jumlah_demaraga ?? null,
      panjang_demaraga ?? null,
      draft ?? null,
      dwt ?? null,
      siklus_pasang ?? null,
      loading_method ?? null,
      loading_rate_mt_per_hour ?? null,
      shipper ?? null,
      linked.siteCode,
      linked.siteId,
    ]);
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterPortToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_loading_ports WHERE id = $1`, [saved.id]);

    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error) {
    logger.error('Create master loading port error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create master port' } });
  }
};

export const updateMasterLoadingPort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      region,
      port,
      coordinate,
      masuk_alur,
      lebar_alur,
      jumlah_jembatan,
      jenis_port,
      pemilik_port,
      antri_muat_hari,
      jumlah_demaraga,
      panjang_demaraga,
      draft,
      dwt,
      siklus_pasang,
      loading_method,
      loading_rate_mt_per_hour,
      shipper,
      dhm_site_code,
      site_id,
    } = req.body;

    const updateSql = `
      UPDATE master_loading_ports
      SET
        region = COALESCE($1, region),
        port = COALESCE($2, port),
        coordinate = COALESCE($3, coordinate),
        masuk_alur = COALESCE($4, masuk_alur),
        lebar_alur = COALESCE($5, lebar_alur),
        jumlah_jembatan = COALESCE($6, jumlah_jembatan),
        jenis_port = COALESCE($7, jenis_port),
        pemilik_port = COALESCE($8, pemilik_port),
        antri_muat_hari = COALESCE($9, antri_muat_hari),
        jumlah_demaraga = COALESCE($10, jumlah_demaraga),
        panjang_demaraga = COALESCE($11, panjang_demaraga),
        draft = COALESCE($12, draft),
        dwt = COALESCE($13, dwt),
        siklus_pasang = COALESCE($14, siklus_pasang),
        loading_method = COALESCE($15, loading_method),
        loading_rate_mt_per_hour = COALESCE($16, loading_rate_mt_per_hour),
        shipper = COALESCE($17, shipper),
        dhm_site_code = CASE WHEN $18::boolean THEN $19 ELSE dhm_site_code END,
        site_id = CASE WHEN $18::boolean THEN $20::uuid ELSE site_id END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $21
      RETURNING *
    `;

    const siteProvided = Object.prototype.hasOwnProperty.call(req.body, 'site_id')
      || Object.prototype.hasOwnProperty.call(req.body, 'dhm_site_code');
    const linked = siteProvided
      ? await resolvePortSite(site_id, dhm_site_code)
      : { siteId: null, siteCode: null };
    const result = await query(updateSql, [
      region ?? null,
      port ?? null,
      coordinate ?? null,
      masuk_alur ?? null,
      lebar_alur ?? null,
      jumlah_jembatan ?? null,
      jenis_port ?? null,
      pemilik_port ?? null,
      antri_muat_hari ?? null,
      jumlah_demaraga ?? null,
      panjang_demaraga ?? null,
      draft ?? null,
      dwt ?? null,
      siklus_pasang ?? null,
      loading_method ?? null,
      loading_rate_mt_per_hour ?? null,
      shipper ?? null,
      siteProvided,
      linked.siteCode,
      linked.siteId,
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master port not found' } });
      return;
    }
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterPortToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_loading_ports WHERE id = $1`, [id]);

    res.json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error) {
    logger.error('Update master loading port error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update master port' } });
  }
};

export const bulkUploadMasterLoadingPorts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = req.body?.rows as Array<any>;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'No rows provided' } });
      return;
    }

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ row: number; port: string; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const {
        region,
        port,
        coordinate,
        masuk_alur,
        lebar_alur,
        jumlah_jembatan,
        jenis_port,
        pemilik_port,
        antri_muat_hari,
        jumlah_demaraga,
        panjang_demaraga,
        draft,
        dwt,
        siklus_pasang,
        loading_method,
        loading_rate_mt_per_hour,
        shipper,
      } = row;

      const portStr = typeof port === 'string' ? port.trim() : String(port ?? '').trim();
      if (!portStr) {
        errors.push({ row: rowNum, port: '(empty)', reason: 'Missing port' });
        continue;
      }

      try {
        const values = [
          region ?? null,
          portStr,
          coordinate ?? null,
          masuk_alur ?? null,
          lebar_alur ?? null,
          jumlah_jembatan ?? null,
          jenis_port ?? null,
          pemilik_port ?? null,
          antri_muat_hari ?? null,
          jumlah_demaraga ?? null,
          panjang_demaraga ?? null,
          draft ?? null,
          dwt ?? null,
          siklus_pasang ?? null,
          loading_method ?? null,
          loading_rate_mt_per_hour ?? null,
          shipper ?? null,
        ];

        const existing = await query(
          'SELECT id FROM master_loading_ports WHERE port = $1 LIMIT 1',
          [portStr]
        );

        if (existing.rows.length > 0) {
          const updateValues = [
            region ?? null,
            coordinate ?? null,
            masuk_alur ?? null,
            lebar_alur ?? null,
            jumlah_jembatan ?? null,
            jenis_port ?? null,
            pemilik_port ?? null,
            antri_muat_hari ?? null,
            jumlah_demaraga ?? null,
            panjang_demaraga ?? null,
            draft ?? null,
            dwt ?? null,
            siklus_pasang ?? null,
            loading_method ?? null,
            loading_rate_mt_per_hour ?? null,
            shipper ?? null,
            existing.rows[0].id,
          ];
          await query(
            `UPDATE master_loading_ports SET
              region = $1, coordinate = $2, masuk_alur = $3, lebar_alur = $4, jumlah_jembatan = $5,
              jenis_port = $6, pemilik_port = $7, antri_muat_hari = $8, jumlah_demaraga = $9, panjang_demaraga = $10,
              draft = $11, dwt = $12, siklus_pasang = $13, loading_method = $14, loading_rate_mt_per_hour = $15, shipper = $16,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $17`,
            updateValues
          );
          updated += 1;
        } else {
          await query(
            `INSERT INTO master_loading_ports (
              region, port, coordinate, masuk_alur, lebar_alur, jumlah_jembatan,
              jenis_port, pemilik_port, antri_muat_hari, jumlah_demaraga, panjang_demaraga,
              draft, dwt, siklus_pasang, loading_method, loading_rate_mt_per_hour, shipper
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            values
          );
          inserted += 1;
        }
      } catch (err: any) {
        const reason = err?.message || err?.code || String(err);
        errors.push({ row: rowNum, port: portStr, reason });
      }
    }

    const failed = errors.length;
    res.json({
      success: true,
      data: {
        total: rows.length,
        inserted,
        updated,
        success: inserted + updated,
        failed,
        errors,
      },
    });
  } catch (error) {
    logger.error('Bulk upload master loading ports error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to upload master ports' } });
  }
};

export const deleteMasterLoadingPort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM master_loading_ports WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master port not found' } });
      return;
    }
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    logger.error('Delete master loading port error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master port' } });
  }
};

