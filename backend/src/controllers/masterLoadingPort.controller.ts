import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

export const listMasterLoadingPorts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [];
    let where = 'WHERE 1=1';

    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      where += ` AND (region ILIKE $${params.length} OR port ILIKE $${params.length})`;
    }

    const listSql = `
      SELECT id, region, port, coordinate, masuk_alur, lebar_alur, jumlah_jembatan,
             jenis_port, pemilik_port, antri_muat_hari, jumlah_demaraga, panjang_demaraga,
             draft, dwt, siklus_pasang, loading_method, loading_rate_mt_per_hour, shipper,
             created_at, updated_at
      FROM master_loading_ports
      ${where}
      ORDER BY region, port
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `
      SELECT COUNT(*) AS count
      FROM master_loading_ports
      ${where}
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
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master loading ports' } });
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
    } = req.body;

    const insertSql = `
      INSERT INTO master_loading_ports (
        region, port, coordinate, masuk_alur, lebar_alur, jumlah_jembatan,
        jenis_port, pemilik_port, antri_muat_hari, jumlah_demaraga, panjang_demaraga,
        draft, dwt, siklus_pasang, loading_method, loading_rate_mt_per_hour, shipper
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING *
    `;
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
    ]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Create master loading port error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create master loading port' } });
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $18
      RETURNING *
    `;

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
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master loading port not found' } });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Update master loading port error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update master loading port' } });
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
    res.status(500).json({ success: false, error: { message: 'Failed to upload master loading ports' } });
  }
};

