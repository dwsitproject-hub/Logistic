import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getShipments = async (req: AuthRequest, res: Response) => {
  try {
    const { status, vessel, port, dateFrom, dateTo, delayed, sto, contract, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const includeSapAggregates = Boolean(sto);

    // Query shipments grouped by STO number or Operation ID:
    // - SAP shipments are grouped by contracts.sto_number
    // - Manual shipments (no STO) are grouped by operation_id so that multiple contracts
    //   under the same operation appear as a single transaction in the UI
    // Base query for shipments grouped by STO/operation/shipment
    let queryText = `
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base AS (
        SELECT 
          COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) as sto_key,
          (array_agg(s.id ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL))[1] as id,
          MAX(COALESCE(c.sto_number::text, l.effective_sto)) as sto_number,
          MAX(s.shipment_id) as shipment_id,
          MAX(s.operation_id) as operation_id,
          MAX(s.vessel_name) as vessel_name,
          MAX(s.vessel_code) as vessel_code,
          MAX(s.voyage_no) as voyage_no,
          MAX(s.vessel_owner) as vessel_owner,
          MAX(s.vessel_draft) as vessel_draft,
          MAX(s.vessel_loa) as vessel_loa,
          MAX(s.vessel_capacity) as vessel_capacity,
          MAX(s.vessel_hull_type) as vessel_hull_type,
          MAX(s.vessel_registration_year) as vessel_registration_year,
          MAX(s.charter_type) as charter_type,
          MAX(s.shipment_date) as shipment_date,
          MAX(s.arrival_date) as arrival_date,
          MAX(s.port_of_loading) as port_of_loading,
          MAX(s.port_of_discharge) as port_of_discharge,
          MAX(s.port_of_discharge) as plant_site,
          -- Basic ETA loading dates at shipment level (kept in sync with first loading port)
          MAX(s.eta_arrival) as eta_arrival,
          MAX(s.eta_berthed) as eta_berthed,
          MAX(s.eta_loading_start) as eta_loading_start,
          MAX(s.eta_loading_complete) as eta_loading_complete,
          MAX(s.eta_sailed) as eta_sailed,
          -- Basic ETA discharge dates at shipment level
          MAX(s.eta_discharge_arrival) as eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) as eta_discharge_berthed,
          MAX(s.eta_discharge_start) as eta_discharge_start,
          MAX(s.eta_discharge_complete) as eta_discharge_complete,
          COALESCE(SUM(s.quantity_shipped), 0) as quantity_shipped,
          COALESCE(SUM(s.quantity_delivered), 0) as quantity_delivered,
          COALESCE(SUM(s.inbound_weight), 0) as inbound_weight,
          COALESCE(SUM(s.outbound_weight), 0) as outbound_weight,
          COALESCE(AVG(s.gain_loss_percentage), 0) as gain_loss_percentage,
          COALESCE(SUM(s.gain_loss_amount), 0) as gain_loss_amount,
          MAX(s.estimated_km) as estimated_km,
          MAX(s.estimated_nautical_miles) as estimated_nautical_miles,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.difference_final_qty_vs_bl_qty) as difference_final_qty_vs_bl_qty,
          MAX(s.average_vessel_speed) as average_vessel_speed,
          MAX(s.status) as status,
          MAX(s.sla_days) as sla_days,
          BOOL_OR(s.is_delayed) as is_delayed,
          MAX(s.sap_delivery_id) as sap_delivery_id,
          MAX(s.created_at) as created_at,
          MAX(s.updated_at) as updated_at,
          -- Aggregate contract data
          STRING_AGG(DISTINCT c.contract_id, ', ' ORDER BY c.contract_id) FILTER (WHERE c.contract_id IS NOT NULL) as contract_numbers,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') as po_numbers,
          MAX(c.supplier) as supplier,
          STRING_AGG(DISTINCT c.supplier, ', ' ORDER BY c.supplier) FILTER (WHERE c.supplier IS NOT NULL) as suppliers,
          MAX(c.buyer) as buyer,
          STRING_AGG(DISTINCT c.buyer, ', ' ORDER BY c.buyer) FILTER (WHERE c.buyer IS NOT NULL) as buyers,
          MAX(c.product) as product,
          STRING_AGG(DISTINCT c.product, ', ' ORDER BY c.product) FILTER (WHERE c.product IS NOT NULL) as products,
          MAX(c.group_name) as group_name,
          STRING_AGG(DISTINCT c.group_name, ', ' ORDER BY c.group_name) FILTER (WHERE c.group_name IS NOT NULL) as group_names,
          COUNT(DISTINCT c.contract_id) FILTER (WHERE c.contract_id IS NOT NULL) as contract_count,
          -- Get delivery dates from contracts
          MAX(c.delivery_start_date) as delivery_start_date,
          MAX(c.delivery_end_date) as delivery_end_date,
          -- Get ATA dates from shipments or vessel_loading_ports
          MAX(COALESCE(s.ata_loading_complete, (SELECT vlp1.ata_loading_completed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) as ata_vessel_completed_loading,
          MAX(COALESCE(s.ata_discharge_complete, (SELECT vlpd.ata_loading_completed::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) as ata_vessel_complete_discharge,
          -- Get ETA dates from shipments or vessel_loading_ports
          MAX(COALESCE(s.eta_discharge_complete, (SELECT vlpd.eta_vessel_complete_discharge::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) as eta_vessel_complete_discharge,
          -- Get contract reference PO from contracts or sap_processed_data
          MAX((SELECT COALESCE(
                  spd.data->'contract'->>'contract_reference_po',
                  spd.data->>'CONTRACT REFF PO'
                )
           FROM sap_processed_data spd
           WHERE TRIM(spd.sto_number::text) = TRIM(COALESCE(c.sto_number::text, l.effective_sto, s.shipment_id))
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1)) AS contract_reference_po,
          -- Get Contract Ext No from sap_processed_data
          MAX((SELECT COALESCE(
                  spd.data->'raw'->>'Contract Ext No',
                  spd.data->>'Contract Ext No'
                )
           FROM sap_processed_data spd
           WHERE TRIM(spd.sto_number::text) = TRIM(COALESCE(c.sto_number::text, l.effective_sto, s.shipment_id))
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1)) AS contract_ext_no
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE 1=1
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (status) {
      queryText += ` AND s.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (vessel) {
      queryText += ` AND s.vessel_name ILIKE $${paramIndex}`;
      queryParams.push(`%${vessel}%`);
      paramIndex++;
    }

    if (port) {
      queryText += ` AND (s.port_of_loading ILIKE $${paramIndex} OR s.port_of_discharge ILIKE $${paramIndex})`;
      queryParams.push(`%${port}%`, `%${port}%`);
      paramIndex += 2;
    }

    if (dateFrom) {
      queryText += ` AND s.shipment_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      queryText += ` AND s.shipment_date <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    if (delayed === 'true') {
      queryText += ` AND s.is_delayed = true`;
    }

    if (sto) {
      queryText += ` AND (TRIM(COALESCE(c.sto_number::text, l.effective_sto, '')) = TRIM($${paramIndex}::text) OR s.shipment_id = $${paramIndex})`;
      queryParams.push(sto);
      paramIndex++;
    }

    if (contract) {
      queryText += ` AND c.contract_id = $${paramIndex}`;
      queryParams.push(contract);
      paramIndex++;
    }

    // Inject sap_processed_data aggregates only when filtering by a specific STO,
    // to avoid a heavy scan for the default "all shipments" view.
    const sapAggregatesSelect = includeSapAggregates
      ? `
        -- Get STO quantity from sap_processed_data
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE
            (
              spd.sto_number IS NOT NULL
              AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
            )
            OR (
              spd.sto_number IS NULL
              AND NULLIF(TRIM(COALESCE(
                spd.data->'raw'->>'STO No.',
                spd.data->'raw'->>'STO Number',
                spd.data->'shipment'->>'sto_no',
                spd.data->'contract'->>'sto_no'
              )), '') = TRIM(sb.sto_key::text)
            )
            AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as sto_quantity,
        -- Get Quantity Receive from sap_processed_data (raw field; accept Quantity Receive or Qty Receive)
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE
            (
              spd.sto_number IS NOT NULL
              AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
            )
            OR (
              spd.sto_number IS NULL
              AND NULLIF(TRIM(COALESCE(
                spd.data->'raw'->>'STO No.',
                spd.data->'raw'->>'STO Number',
                spd.data->'shipment'->>'sto_no',
                spd.data->'contract'->>'sto_no'
              )), '') = TRIM(sb.sto_key::text)
            )
            AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
        ), 0) as quantity_receive,
        -- Get Quantity Delivered from sap_processed_data (raw field; accept Quantity Delivered or Quantity Delivery)
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE
            (
              spd.sto_number IS NOT NULL
              AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
            )
            OR (
              spd.sto_number IS NULL
              AND NULLIF(TRIM(COALESCE(
                spd.data->'raw'->>'STO No.',
                spd.data->'raw'->>'STO Number',
                spd.data->'shipment'->>'sto_no',
                spd.data->'contract'->>'sto_no'
              )), '') = TRIM(sb.sto_key::text)
            )
            AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
        ), 0) as quantity_delivered_sap,
        -- Basic ETA loading dates at shipment level (used for ETA Loading Status buckets)
        MAX(s.eta_arrival::date) as eta_arrival,
        MAX(s.eta_berthed::date) as eta_berthed,
        MAX(s.eta_loading_start::date) as eta_loading_start,
        MAX(s.eta_loading_complete::date) as eta_loading_complete,
        MAX(s.eta_sailed::date) as eta_sailed,
        -- Get incoterm, B2B flag, source_type from latest sap_processed_data
        (SELECT COALESCE(
                  spd.data->'contract'->>'incoterm',
                  spd.data->>'Incoterm'
                )
           FROM sap_processed_data spd
           WHERE
             (
               spd.sto_number IS NOT NULL
               AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
             )
             OR (
               spd.sto_number IS NULL
               AND NULLIF(TRIM(COALESCE(
                 spd.data->'raw'->>'STO No.',
                 spd.data->'raw'->>'STO Number',
                 spd.data->'shipment'->>'sto_no',
                 spd.data->'contract'->>'sto_no'
               )), '') = TRIM(sb.sto_key::text)
             )
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS incoterm,
        (SELECT COALESCE(
                  spd.data->'contract'->>'contract_type',
                  spd.data->>'B2B Flag',
                  spd.data->>'Contract Type'
                )
           FROM sap_processed_data spd
           WHERE
             (
               spd.sto_number IS NOT NULL
               AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
             )
             OR (
               spd.sto_number IS NULL
               AND NULLIF(TRIM(COALESCE(
                 spd.data->'raw'->>'STO No.',
                 spd.data->'raw'->>'STO Number',
                 spd.data->'shipment'->>'sto_no',
                 spd.data->'contract'->>'sto_no'
               )), '') = TRIM(sb.sto_key::text)
             )
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS b2b_flag,
        (SELECT COALESCE(
                  spd.data->'contract'->>'source_type',
                  spd.data->>'Source'
                )
           FROM sap_processed_data spd
           WHERE
             (
               spd.sto_number IS NOT NULL
               AND TRIM(spd.sto_number::text) = TRIM(sb.sto_key::text)
             )
             OR (
               spd.sto_number IS NULL
               AND NULLIF(TRIM(COALESCE(
                 spd.data->'raw'->>'STO No.',
                 spd.data->'raw'->>'STO Number',
                 spd.data->'shipment'->>'sto_no',
                 spd.data->'contract'->>'sto_no'
               )), '') = TRIM(sb.sto_key::text)
             )
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS source_type`
      : `
        0::numeric as sto_quantity,
        0::numeric as quantity_receive,
        0::numeric as quantity_delivered_sap,
        NULL::text as incoterm,
        NULL::text as b2b_flag,
        NULL::text as source_type`;

    queryText += `
        GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)
      )
      SELECT 
        sb.*,
${sapAggregatesSelect}
      FROM shipment_base sb
      ORDER BY sb.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await query(queryText, queryParams);

    // When grouping by STO, display STO No from sto_key when contracts.sto_number is empty,
    // but only if sto_key looks like a real STO number (numeric), not an operation ID or manual code.
    for (const row of result.rows) {
      const currentStoNumber = row.sto_number;
      const stoKeyStr = row.sto_key != null ? String(row.sto_key).trim() : '';

      if (
        (currentStoNumber == null || String(currentStoNumber).trim() === '') &&
        stoKeyStr &&
        /^\d+$/.test(stoKeyStr) // treat only purely numeric values as valid STO numbers
      ) {
        row.sto_number = stoKeyStr;
      }
    }

    // Get total count (grouped by STO)
    let countQuery = `
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT COUNT(DISTINCT COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)) as count 
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;
    
    if (status) {
      countQuery += ` AND s.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (vessel) {
      countQuery += ` AND s.vessel_name ILIKE $${countParamIndex}`;
      countParams.push(`%${vessel}%`);
      countParamIndex++;
    }

    if (port) {
      countQuery += ` AND (s.port_of_loading ILIKE $${countParamIndex} OR s.port_of_discharge ILIKE $${countParamIndex})`;
      countParams.push(`%${port}%`, `%${port}%`);
      countParamIndex += 2;
    }

    if (dateFrom) {
      countQuery += ` AND s.shipment_date >= $${countParamIndex}`;
      countParams.push(dateFrom);
      countParamIndex++;
    }

    if (dateTo) {
      countQuery += ` AND s.shipment_date <= $${countParamIndex}`;
      countParams.push(dateTo);
      countParamIndex++;
    }

    if (delayed === 'true') {
      countQuery += ` AND s.is_delayed = true`;
    }

    if (sto) {
      countQuery += ` AND (TRIM(COALESCE(c.sto_number::text, l.effective_sto, '')) = TRIM($${countParamIndex}::text) OR s.shipment_id = $${countParamIndex})`;
      countParams.push(sto);
      countParamIndex++;
    }

    if (contract) {
      countQuery += ` AND c.contract_id = $${countParamIndex}`;
      countParams.push(contract);
      countParamIndex++;
    }

    const countResult = await query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count) || 0;

    return res.json({
      success: true,
      data: {
        shipments: result.rows,
        pagination: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
    });
  } catch (error: any) {
    logger.error('Get shipments error:', error);
    const errorMessage = error.message || 'Failed to fetch shipments';
    const errorDetail = error.detail || error.toString();
    
    logger.error('Error details:', {
      message: errorMessage,
      detail: errorDetail,
      code: error.code,
      query: error.query
    });
    
    return res.status(500).json({
      success: false,
      error: { 
        message: errorMessage,
        detail: process.env.NODE_ENV === 'development' ? errorDetail : undefined
      },
    });
  }
};

export const getShipmentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        s.*,
        c.contract_id as contract_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.unit
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get shipment by ID error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipment' },
    });
  }
};

export const updateShipment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    logger.info('Update shipment request:', { id, updateData });

    // Validate required fields
    if (!updateData.shipment_id) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment ID is required' },
      });
    }

    // Check if id is a UUID or STO number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    let shipmentId: string;
    if (isUUID) {
      // id is a UUID, use it directly
      shipmentId = id;
    } else {
      // id is a STO number, find the shipment UUID
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s 
         JOIN contracts c ON s.contract_id = c.id 
         WHERE c.sto_number = $1 LIMIT 1`,
        [id]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found for STO number' },
        });
      }
      
      shipmentId = shipmentResult.rows[0].id;
    }

    // Build the update query with explicit field handling
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // Handle each field explicitly with proper type casting
    // Skip shipment_id update to avoid duplicate key conflicts
    // The shipment_id should remain unchanged during updates

    if (updateData.status) {
      updateFields.push(`status = $${paramIndex}`);
      updateValues.push(updateData.status);
      paramIndex++;
    }

    if (updateData.vessel_code) {
      updateFields.push(`vessel_code = $${paramIndex}`);
      updateValues.push(updateData.vessel_code);
      paramIndex++;
    }

    if (updateData.vessel_loa !== undefined && updateData.vessel_loa !== null) {
      updateFields.push(`vessel_loa = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_loa);
      paramIndex++;
    }

    if (updateData.vessel_registration_year !== undefined && updateData.vessel_registration_year !== null) {
      updateFields.push(`vessel_registration_year = $${paramIndex}::int`);
      updateValues.push(updateData.vessel_registration_year);
      paramIndex++;
    }

    if (updateData.vessel_name) {
      updateFields.push(`vessel_name = $${paramIndex}`);
      updateValues.push(updateData.vessel_name);
      paramIndex++;
    }

    if (updateData.voyage_no) {
      updateFields.push(`voyage_no = $${paramIndex}`);
      updateValues.push(updateData.voyage_no);
      paramIndex++;
    }

    if (updateData.vessel_owner) {
      updateFields.push(`vessel_owner = $${paramIndex}`);
      updateValues.push(updateData.vessel_owner);
      paramIndex++;
    }

    if (updateData.vessel_draft !== undefined && updateData.vessel_draft !== null) {
      updateFields.push(`vessel_draft = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_draft);
      paramIndex++;
    }

    if (updateData.vessel_capacity !== undefined && updateData.vessel_capacity !== null) {
      updateFields.push(`vessel_capacity = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_capacity);
      paramIndex++;
    }

    if (updateData.vessel_hull_type) {
      updateFields.push(`vessel_hull_type = $${paramIndex}`);
      updateValues.push(updateData.vessel_hull_type);
      paramIndex++;
    }

    if (updateData.charter_type) {
      updateFields.push(`charter_type = $${paramIndex}`);
      updateValues.push(updateData.charter_type);
      paramIndex++;
    }

    if (updateData.port_of_loading) {
      updateFields.push(`port_of_loading = $${paramIndex}`);
      updateValues.push(updateData.port_of_loading);
      paramIndex++;
    }

    if (updateData.port_of_discharge) {
      updateFields.push(`port_of_discharge = $${paramIndex}`);
      updateValues.push(updateData.port_of_discharge);
      paramIndex++;
    }

    if (updateData.shipment_date) {
      updateFields.push(`shipment_date = $${paramIndex}::date`);
      updateValues.push(updateData.shipment_date);
      paramIndex++;
    }

    if (updateData.arrival_date) {
      updateFields.push(`arrival_date = $${paramIndex}::date`);
      updateValues.push(updateData.arrival_date);
      paramIndex++;
    }

    if (updateData.quantity_shipped !== undefined && updateData.quantity_shipped !== null) {
      updateFields.push(`quantity_shipped = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_shipped);
      paramIndex++;
    }

    if (updateData.quantity_delivered !== undefined && updateData.quantity_delivered !== null) {
      updateFields.push(`quantity_delivered = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_delivered);
      paramIndex++;
    }

    if (updateData.bl_quantity !== undefined && updateData.bl_quantity !== null) {
      updateFields.push(`bl_quantity = $${paramIndex}::numeric`);
      updateValues.push(updateData.bl_quantity);
      paramIndex++;
    }

    if (updateData.actual_vessel_qty_receive !== undefined && updateData.actual_vessel_qty_receive !== null) {
      updateFields.push(`actual_vessel_qty_receive = $${paramIndex}::numeric`);
      updateValues.push(updateData.actual_vessel_qty_receive);
      paramIndex++;
    }

    if (updateData.difference_final_qty_vs_bl_qty !== undefined && updateData.difference_final_qty_vs_bl_qty !== null) {
      updateFields.push(`difference_final_qty_vs_bl_qty = $${paramIndex}::numeric`);
      updateValues.push(updateData.difference_final_qty_vs_bl_qty);
      paramIndex++;
    }

    if (updateData.gain_loss_percentage !== undefined && updateData.gain_loss_percentage !== null) {
      updateFields.push(`gain_loss_percentage = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_percentage);
      paramIndex++;
    }

    if (updateData.gain_loss_amount !== undefined && updateData.gain_loss_amount !== null) {
      updateFields.push(`gain_loss_amount = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_amount);
      paramIndex++;
    }

    if (updateData.estimated_km !== undefined && updateData.estimated_km !== null) {
      updateFields.push(`estimated_km = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_km);
      paramIndex++;
    }

    if (updateData.estimated_nautical_miles !== undefined && updateData.estimated_nautical_miles !== null) {
      updateFields.push(`estimated_nautical_miles = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_nautical_miles);
      paramIndex++;
    }

    if (updateData.vessel_oa_budget !== undefined && updateData.vessel_oa_budget !== null) {
      updateFields.push(`vessel_oa_budget = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_budget);
      paramIndex++;
    }

    if (updateData.vessel_oa_actual !== undefined && updateData.vessel_oa_actual !== null) {
      updateFields.push(`vessel_oa_actual = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_actual);
      paramIndex++;
    }

    if (updateData.average_vessel_speed !== undefined && updateData.average_vessel_speed !== null) {
      updateFields.push(`average_vessel_speed = $${paramIndex}::numeric`);
      updateValues.push(updateData.average_vessel_speed);
      paramIndex++;
    }

    if (updateData.sla_days !== undefined && updateData.sla_days !== null) {
      updateFields.push(`sla_days = $${paramIndex}::numeric`);
      updateValues.push(updateData.sla_days);
      paramIndex++;
    }

    if (updateData.is_delayed !== undefined && updateData.is_delayed !== null) {
      updateFields.push(`is_delayed = $${paramIndex}::boolean`);
      updateValues.push(updateData.is_delayed);
      paramIndex++;
    }

    if (updateData.sap_delivery_id) {
      updateFields.push(`sap_delivery_id = $${paramIndex}`);
      updateValues.push(updateData.sap_delivery_id);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No valid fields to update' },
      });
    }

    // Add updated_at timestamp
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(shipmentId);

    const queryText = `
      UPDATE shipments 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    logger.info('Executing query:', { queryText, updateValues, paramIndex });
    
    const result = await query(queryText, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    logger.info('Shipment updated:', { id, updatedFields: updateFields.length });

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Shipment updated successfully',
    });
  } catch (error) {
    logger.error('Update shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update shipment' },
    });
  }
};

// Get vessel loading ports for a shipment or STO
export const getVesselLoadingPorts = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId } = req.params;
    logger.info('Getting vessel loading ports for:', { shipmentId });

    // Check if shipmentId is a UUID (individual shipment) or STO number (aggregated)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    logger.info('Is UUID:', isUUID);

    let portsResult;
    let shipmentInfoResult;
    
    if (isUUID) {
      // Get loading ports for a specific shipment
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE vlp.shipment_id = $1 
         ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );

      // Backfill: if shipment has port names but no vessel_loading_ports rows, create one loading + one discharge row from shipments
      if (portsResult.rows.length === 0) {
        const shipRow = await query(
          `SELECT id, port_of_loading, port_of_discharge, actual_vessel_qty_receive
           FROM shipments WHERE id = $1`,
          [shipmentId]
        );
        if (shipRow.rows.length > 0) {
          const s = shipRow.rows[0];
          const pol = (s.port_of_loading && String(s.port_of_loading).trim()) || null;
          const pod = (s.port_of_discharge && String(s.port_of_discharge).trim()) || null;
          if (pol) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 1, $3::numeric, false)`,
              [shipmentId, pol, s.actual_vessel_qty_receive ?? null]
            );
          }
          if (pod) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 999, 0, true)`,
              [shipmentId, pod]
            );
          }
          if (pol || pod) {
            portsResult = await query(
              `SELECT vlp.id, vlp.shipment_id, vlp.port_name, vlp.port_sequence, vlp.quantity_at_loading_port,
                vlp.eta_vessel_arrival, vlp.ata_vessel_arrival, vlp.eta_vessel_berthed, vlp.ata_vessel_berthed,
                vlp.eta_loading_start, vlp.ata_loading_start, vlp.eta_loading_completed, vlp.ata_loading_completed,
                vlp.eta_vessel_sailed, vlp.ata_vessel_sailed,
                vlp.eta_vessel_berthed_at_loading_port, vlp.eta_vessel_arrive_at_discharge_port,
                vlp.eta_vessel_berthed_at_discharge_port, vlp.eta_vessel_start_discharging, vlp.eta_vessel_complete_discharge,
                vlp.loading_rate, vlp.quality_ffa, vlp.quality_mi, vlp.quality_dobi, vlp.quality_red, vlp.quality_ds, vlp.quality_stone,
                vlp.is_discharge_port, vlp.created_at, vlp.updated_at,
                c.contract_id as contract_number
               FROM vessel_loading_ports vlp
               LEFT JOIN shipments sh ON vlp.shipment_id = sh.id
               LEFT JOIN contracts c ON sh.contract_id = c.id
               WHERE vlp.shipment_id = $1
               ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
              [shipmentId]
            );
          }
        }
      }

      // Get shipment-level information
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          s.quantity_delivered,
          s.actual_vessel_qty_receive,
          s.vessel_oa_actual,
          s.vessel_oa_budget,
          s.bl_quantity,
          s.port_of_loading as vessel_loading_port_1,
          s.port_of_discharge as vessel_discharge_port_1,
          c.contract_id as contract_number,
          COALESCE(s.ata_arrival, vlp1.ata_vessel_arrival::date) as ata_vessel_arrival_at_loading_port,
          COALESCE(s.ata_berthed, vlp1.ata_vessel_berthed::date) as ata_vessel_berthed_at_loading_port,
          COALESCE(s.ata_loading_start, vlp1.ata_loading_start::date) as ata_vessel_start_loading,
          COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed::date) as ata_vessel_completed_loading,
          COALESCE(s.ata_sailed, vlp1.ata_vessel_sailed::date) as ata_vessel_sailed_from_loading_port,
          COALESCE(s.ata_discharge_arrival, vlpd.ata_vessel_arrival::date) as ata_vessel_arrive_at_discharge_port,
          COALESCE(s.ata_discharge_berthed, vlpd.ata_vessel_berthed::date) as ata_vessel_berthed_at_discharge_port,
          COALESCE(s.ata_discharge_start, vlpd.ata_loading_start::date) as ata_vessel_start_discharging,
          COALESCE(s.ata_discharge_complete, vlpd.ata_loading_completed::date) as ata_vessel_complete_discharge,
          -- ETA fields: prefer vessel_loading_ports, fallback to shipments so UI shows data from either table
          COALESCE(vlp1.eta_vessel_arrival::date, s.eta_arrival) as eta_vessel_arrival_at_loading_port,
          COALESCE(vlp1.eta_vessel_berthed_at_loading_port::date, s.eta_berthed) as eta_vessel_berthed_at_loading_port,
          COALESCE(vlp1.eta_loading_start::date, s.eta_loading_start) as eta_vessel_start_loading,
          COALESCE(vlp1.eta_loading_completed::date, s.eta_loading_complete) as eta_vessel_completed_loading,
          COALESCE(vlp1.eta_vessel_sailed::date, s.eta_sailed) as eta_vessel_sailed_from_loading_port,
          COALESCE(vlpd.eta_vessel_arrive_at_discharge_port::date, s.eta_discharge_arrival) as eta_vessel_arrive_at_discharge_port,
          COALESCE(vlpd.eta_vessel_berthed_at_discharge_port::date, s.eta_discharge_berthed) as eta_vessel_berthed_at_discharge_port,
          COALESCE(vlpd.eta_vessel_start_discharging::date, s.eta_discharge_start) as eta_vessel_start_discharging,
          COALESCE(vlpd.eta_vessel_complete_discharge::date, s.eta_discharge_complete) as eta_vessel_complete_discharge,
          -- Calculate Loading Rate: Quantity Receive / (ATA Completed Loading - ATA Start Loading) in hours
          CASE 
            WHEN s.actual_vessel_qty_receive > 0 
              AND COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed) IS NOT NULL
              AND COALESCE(s.ata_loading_start, vlp1.ata_loading_start) IS NOT NULL
            THEN s.actual_vessel_qty_receive / NULLIF(
              EXTRACT(EPOCH FROM (COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed) - COALESCE(s.ata_loading_start, vlp1.ata_loading_start))) / 3600.0,
              0
            )
            ELSE NULL
          END as loading_rate_mt_per_hour,
          -- Quality fields from first loading port
          vlp1.quality_ffa as quality_at_loading_loc_1_ffa,
          vlp1.quality_mi as quality_at_loading_loc_1_mi,
          vlp1.quality_dobi as quality_at_loading_loc_1_dobi,
          vlp1.quality_red as quality_at_loading_loc_1_red,
          vlp1.quality_ds as quality_at_loading_loc_1_ds,
          vlp1.quality_stone as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          vlpd.quality_ffa as quality_at_discharge_loc_1_ffa,
          vlpd.quality_mi as quality_at_discharge_loc_1_mi,
          vlpd.quality_dobi as quality_at_discharge_loc_1_dobi,
          vlpd.quality_red as quality_at_discharge_loc_1_red,
          vlpd.quality_ds as quality_at_discharge_loc_1_ds,
          vlpd.quality_stone as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true
         WHERE s.id = $1
         LIMIT 1`,
        [shipmentId]
      );
    } else {
      // Get loading ports for all shipments under this STO
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         ORDER BY c.contract_id, vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );
      
      // Get shipment-level information (aggregated by STO)
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          MAX(s.quantity_delivered) as quantity_delivered,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.port_of_loading) as vessel_loading_port_1,
          MAX(s.port_of_discharge) as vessel_discharge_port_1,
          MAX(c.contract_id) as contract_number,
          MAX(COALESCE(s.ata_arrival, vlp1.ata_vessel_arrival::date)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(s.ata_berthed, vlp1.ata_vessel_berthed::date)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start::date)) as ata_vessel_start_loading,
          MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed::date)) as ata_vessel_completed_loading,
          MAX(COALESCE(s.ata_sailed, vlp1.ata_vessel_sailed::date)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(s.ata_discharge_arrival, vlpd.ata_vessel_arrival::date)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_berthed, vlpd.ata_vessel_berthed::date)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_start, vlpd.ata_loading_start::date)) as ata_vessel_start_discharging,
          MAX(COALESCE(s.ata_discharge_complete, vlpd.ata_loading_completed::date)) as ata_vessel_complete_discharge,
          -- ETA fields from loading ports
          MAX(vlp1.eta_vessel_arrival::date) as eta_vessel_arrival_at_loading_port,
          MAX(vlp1.eta_vessel_berthed_at_loading_port::date) as eta_vessel_berthed_at_loading_port,
          MAX(vlp1.eta_loading_start::date) as eta_vessel_start_loading,
          MAX(vlp1.eta_loading_completed::date) as eta_vessel_completed_loading,
          MAX(vlp1.eta_vessel_sailed::date) as eta_vessel_sailed_from_loading_port,
          MAX(vlpd.eta_vessel_arrive_at_discharge_port::date) as eta_vessel_arrive_at_discharge_port,
          MAX(vlpd.eta_vessel_berthed_at_discharge_port::date) as eta_vessel_berthed_at_discharge_port,
          MAX(vlpd.eta_vessel_start_discharging::date) as eta_vessel_start_discharging,
          MAX(vlpd.eta_vessel_complete_discharge::date) as eta_vessel_complete_discharge,
          -- Calculate Loading Rate: Quantity Receive / (ATA Completed Loading - ATA Start Loading) in hours
          CASE 
            WHEN MAX(s.actual_vessel_qty_receive) > 0 
              AND MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed)) IS NOT NULL
              AND MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)) IS NOT NULL
            THEN MAX(s.actual_vessel_qty_receive) / NULLIF(
              EXTRACT(EPOCH FROM (MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed)) - MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)))) / 3600.0,
              0
            )
            ELSE NULL
          END as loading_rate_mt_per_hour,
          -- Quality fields from first loading port
          MAX(vlp1.quality_ffa) as quality_at_loading_loc_1_ffa,
          MAX(vlp1.quality_mi) as quality_at_loading_loc_1_mi,
          MAX(vlp1.quality_dobi) as quality_at_loading_loc_1_dobi,
          MAX(vlp1.quality_red) as quality_at_loading_loc_1_red,
          MAX(vlp1.quality_ds) as quality_at_loading_loc_1_ds,
          MAX(vlp1.quality_stone) as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          MAX(vlpd.quality_ffa) as quality_at_discharge_loc_1_ffa,
          MAX(vlpd.quality_mi) as quality_at_discharge_loc_1_mi,
          MAX(vlpd.quality_dobi) as quality_at_discharge_loc_1_dobi,
          MAX(vlpd.quality_red) as quality_at_discharge_loc_1_red,
          MAX(vlpd.quality_ds) as quality_at_discharge_loc_1_ds,
          MAX(vlpd.quality_stone) as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         GROUP BY COALESCE(c.sto_number, s.shipment_id)`,
        [shipmentId]
      );
    }

    let shipmentInfo = shipmentInfoResult.rows[0] || null;

    // Fallback: if all ATA fields are null but SAP processed data has values,
    // hydrate shipmentInfo ATA dates directly from sap_processed_data.shipment.
    if (shipmentInfo && shipmentInfo.contract_number) {
      const ataKeys = [
        'ata_vessel_arrival_at_loading_port',
        'ata_vessel_berthed_at_loading_port',
        'ata_vessel_start_loading',
        'ata_vessel_completed_loading',
        'ata_vessel_sailed_from_loading_port',
        'ata_vessel_arrive_at_discharge_port',
        'ata_vessel_berthed_at_discharge_port',
        'ata_vessel_start_discharging',
        'ata_vessel_complete_discharge'
      ] as const;

      const allAtaNull = ataKeys.every(
        (k) => shipmentInfo[k as keyof typeof shipmentInfo] == null
      );

      if (allAtaNull) {
        const sapResult = await query(
          `SELECT data
             FROM sap_processed_data
            WHERE contract_number = $1
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1`,
          [shipmentInfo.contract_number]
        );

        if (sapResult.rows.length > 0) {
          const data: any = sapResult.rows[0].data || {};
          const shp: any = data.shipment || {};

          const normalizeDate = (value: any): string | null => {
            if (value === null || value === undefined || value === '') return null;
            if (value instanceof Date && !isNaN(value.getTime())) {
              return value.toISOString().split('T')[0];
            }
            if (typeof value === 'number') {
              // Interpret as Excel serial date (days since 1899-12-30)
              const excelEpoch = Date.UTC(1899, 11, 30);
              const ms = excelEpoch + value * 86400000;
              const d = new Date(ms);
              if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
              return null;
            }
            if (typeof value === 'string') {
              const d = new Date(value);
              if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
            }
            return null;
          };

          const mapping: Record<string, string> = {
            ata_vessel_arrival_at_loading_port: 'ata_vessel_arrival_at_loading_port_1',
            ata_vessel_berthed_at_loading_port: 'ata_vessel_berthed_at_loading_port_1',
            ata_vessel_start_loading: 'ata_vessel_start_loading',
            ata_vessel_completed_loading: 'ata_vessel_completed_loading',
            ata_vessel_sailed_from_loading_port: 'ata_vessel_sailed_from_loading_port',
            ata_vessel_arrive_at_discharge_port: 'ata_vessel_arrival_at_discharge_port',
            ata_vessel_berthed_at_discharge_port: 'ata_vessel_berthed_at_discharge_port',
            ata_vessel_start_discharging: 'ata_vessel_start_discharging',
            ata_vessel_complete_discharge: 'ata_vessel_completed_discharge'
          };

          for (const [uiKey, sapKey] of Object.entries(mapping)) {
            const current = (shipmentInfo as any)[uiKey];
            if (current == null && shp && sapKey in shp) {
              const normalized = normalizeDate(shp[sapKey]);
              if (normalized) {
                (shipmentInfo as any)[uiKey] = normalized;
              }
            }
          }
        }
      }
    }
    logger.info('ShipmentInfo result:', { 
      hasData: !!shipmentInfo,
      rowCount: shipmentInfoResult.rows.length,
      sample: shipmentInfo ? {
        quantity_delivered: shipmentInfo.quantity_delivered,
        actual_vessel_qty_receive: shipmentInfo.actual_vessel_qty_receive
      } : null
    });

    return res.json({
      success: true,
      data: {
        ports: portsResult.rows,
        shipmentInfo: shipmentInfo,
      },
    });
  } catch (error) {
    logger.error('Get vessel loading ports error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch vessel loading ports' },
    });
  }
};

// Add or update vessel loading port
export const upsertVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;
    
    // Check if shipmentId is a UUID or STO number/shipment_id, and convert to actual shipment UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    let actualShipmentId: string;
    
    if (isUUID) {
      actualShipmentId = shipmentId;
    } else {
      // Find the shipment UUID by STO number or shipment_id
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         LIMIT 1`,
        [shipmentId]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found' },
        });
      }
      
      actualShipmentId = shipmentResult.rows[0].id;
    }
    
    const {
      id: bodyId,
      port_name,
      port_sequence,
      quantity_at_loading_port,
      eta_vessel_arrival,
      ata_vessel_arrival,
      eta_vessel_berthed,
      ata_vessel_berthed,
      eta_loading_start,
      ata_loading_start,
      eta_loading_completed,
      ata_loading_completed,
      eta_vessel_sailed,
      ata_vessel_sailed,
      eta_vessel_berthed_at_loading_port,
      eta_vessel_arrive_at_discharge_port,
      eta_vessel_berthed_at_discharge_port,
      eta_vessel_start_discharging,
      eta_vessel_complete_discharge
    } = req.body;

    // Normalize date-like fields: empty string or invalid -> null so DB accepts them
    const toDateOrNull = (v: unknown): string | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
      if (typeof v === 'string') {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return v;
      }
      return null;
    };
    const eta_vessel_arrival_n = toDateOrNull(eta_vessel_arrival);
    const ata_vessel_arrival_n = toDateOrNull(ata_vessel_arrival);
    const eta_vessel_berthed_n = toDateOrNull(eta_vessel_berthed);
    const ata_vessel_berthed_n = toDateOrNull(ata_vessel_berthed);
    const eta_loading_start_n = toDateOrNull(eta_loading_start);
    const ata_loading_start_n = toDateOrNull(ata_loading_start);
    const eta_loading_completed_n = toDateOrNull(eta_loading_completed);
    const ata_loading_completed_n = toDateOrNull(ata_loading_completed);
    const eta_vessel_sailed_n = toDateOrNull(eta_vessel_sailed);
    const ata_vessel_sailed_n = toDateOrNull(ata_vessel_sailed);
    const eta_vessel_berthed_at_loading_port_n = toDateOrNull(eta_vessel_berthed_at_loading_port);
    const eta_vessel_arrive_at_discharge_port_n = toDateOrNull(eta_vessel_arrive_at_discharge_port);
    const eta_vessel_berthed_at_discharge_port_n = toDateOrNull(eta_vessel_berthed_at_discharge_port);
    const eta_vessel_start_discharging_n = toDateOrNull(eta_vessel_start_discharging);
    const eta_vessel_complete_discharge_n = toDateOrNull(eta_vessel_complete_discharge);

    // Prefer explicit id from body, then fallback to route param (for PUT /:shipmentId/loading-ports/:portId)
    const id = bodyId || portId;

    // Calculate loading rate if we have the required data
    let loading_rate = null;
    if (ata_loading_completed && ata_loading_start && quantity_at_loading_port) {
      const startTime = new Date(ata_loading_start);
      const endTime = new Date(ata_loading_completed);
      const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      if (hours > 0) {
        loading_rate = parseFloat(quantity_at_loading_port) / hours;
      }
    }

    if (id) {
      // Update existing loading port
      const result = await query(
        `UPDATE vessel_loading_ports 
         SET 
           port_name = $2,
           port_sequence = $3,
           quantity_at_loading_port = $4,
           eta_vessel_arrival = $5,
           ata_vessel_arrival = $6,
           eta_vessel_berthed = $7,
           ata_vessel_berthed = $8,
           eta_loading_start = $9,
           ata_loading_start = $10,
           eta_loading_completed = $11,
           ata_loading_completed = $12,
           eta_vessel_sailed = $13,
           ata_vessel_sailed = $14,
           eta_vessel_berthed_at_loading_port = $15,
           eta_vessel_arrive_at_discharge_port = $16,
           eta_vessel_berthed_at_discharge_port = $17,
           eta_vessel_start_discharging = $18,
           eta_vessel_complete_discharge = $19,
           loading_rate = $20,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND shipment_id = $21
         RETURNING *`,
        [
          id, port_name, port_sequence, quantity_at_loading_port,
          eta_vessel_arrival_n, ata_vessel_arrival_n, eta_vessel_berthed_n, ata_vessel_berthed_n,
          eta_loading_start_n, ata_loading_start_n, eta_loading_completed_n, ata_loading_completed_n,
          eta_vessel_sailed_n, ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate,
          actualShipmentId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Vessel loading port not found' },
        });
      }

      const updated = result.rows[0];
      if (updated.port_sequence === 1 && !updated.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port updated successfully',
      });
    } else {
      // Create new loading port
      const result = await query(
        `INSERT INTO vessel_loading_ports 
         (shipment_id, port_name, port_sequence, quantity_at_loading_port,
          eta_vessel_arrival, ata_vessel_arrival, eta_vessel_berthed, ata_vessel_berthed,
          eta_loading_start, ata_loading_start, eta_loading_completed, ata_loading_completed,
          eta_vessel_sailed, ata_vessel_sailed,
          eta_vessel_berthed_at_loading_port,
          eta_vessel_arrive_at_discharge_port,
          eta_vessel_berthed_at_discharge_port,
          eta_vessel_start_discharging,
          eta_vessel_complete_discharge,
          loading_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING *`,
        [
          actualShipmentId, port_name, port_sequence, quantity_at_loading_port,
          eta_vessel_arrival_n, ata_vessel_arrival_n, eta_vessel_berthed_n, ata_vessel_berthed_n,
          eta_loading_start_n, ata_loading_start_n, eta_loading_completed_n, ata_loading_completed_n,
          eta_vessel_sailed_n, ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate
        ]
      );

      const inserted = result.rows[0];
      if (inserted.port_sequence === 1 && !inserted.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port created successfully',
      });
    }
  } catch (error) {
    logger.error('Upsert vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save vessel loading port' },
    });
  }
};

// Delete vessel loading port
export const deleteVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;

    const result = await query(
      'DELETE FROM vessel_loading_ports WHERE id = $1 AND shipment_id = $2 RETURNING *',
      [portId, shipmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Vessel loading port not found' },
      });
    }

    return res.json({
      success: true,
      message: 'Vessel loading port deleted successfully',
    });
  } catch (error) {
    logger.error('Delete vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to delete vessel loading port' },
    });
  }
};

// Get contract suggestions for auto-complete
export const getContractSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || String(q).trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const result = await query(`
      SELECT 
        contract_id,
        po_number,
        supplier,
        product,
        group_name,
        sto_number,
        sto_quantity
      FROM contracts 
      WHERE UPPER(COALESCE(status, '')) IN ('OPEN', 'ACTIVE')
        AND (contract_id ILIKE $1 OR po_number ILIKE $1)
      ORDER BY contract_id
      LIMIT 10
    `, [`%${q}%`]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get contract suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to get contract suggestions' },
    });
  }
};

// Validate contract number and return contract details
export const validateContractNumber = async (req: AuthRequest, res: Response) => {
  try {
    const { contract_number } = req.query;

    if (!contract_number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number is required' },
      });
    }

    const result = await query(
      `SELECT 
        c.id,
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        COALESCE(
          c.quantity_ordered - COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data 
            WHERE contract_number = c.contract_id 
              AND sto_number IS NOT NULL 
              AND data->'contract'->>'sto_quantity' IS NOT NULL
          ), 0),
          c.quantity_ordered
        ) AS outstanding_quantity,
        c.unit,
        c.delivery_start_date,
        c.delivery_end_date,
        c.transport_mode,
        -- Ports are not stored on contracts; derive from latest SAP processed data if available
        NULLIF(NULLIF((
          SELECT spd.data->'shipment'->>'vessel_loading_port_1'
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND spd.data->'shipment'->>'vessel_loading_port_1' IS NOT NULL
            AND TRIM(spd.data->'shipment'->>'vessel_loading_port_1') <> ''
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ), ''), '0.00') as port_of_loading,
        NULLIF(NULLIF((
          SELECT spd.data->'shipment'->>'vessel_discharge_port'
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND spd.data->'shipment'->>'vessel_discharge_port' IS NOT NULL
            AND TRIM(spd.data->'shipment'->>'vessel_discharge_port') <> ''
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ), ''), '0.00') as port_of_discharge
       FROM contracts c
       WHERE c.contract_id = $1
       LIMIT 1`,
      [contract_number]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        message: 'Contract number does not exist',
      });
    }

    return res.json({
      success: true,
      exists: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Validate contract number error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to validate contract number' },
    });
  }
};

// Check if STO number already exists
export const checkStoExists = async (req: AuthRequest, res: Response) => {
  try {
    const { stoNumber } = req.params;
    
    const result = await query(`
      SELECT 
        sto_number,
        STRING_AGG(DISTINCT contract_id, ', ' ORDER BY contract_id) as contract_numbers,
        COUNT(DISTINCT contract_id) as contract_count
      FROM contracts 
      WHERE sto_number = $1
      GROUP BY sto_number
    `, [stoNumber]);

    if (result.rows.length > 0) {
      return res.json({
        success: true,
        exists: true,
        data: result.rows[0]
      });
    }

    return res.json({
      success: true,
      exists: false,
      data: null
    });
  } catch (error) {
    logger.error('Check STO exists error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to check STO number' },
    });
  }
};

// Create new shipment
// Get contract details with STO quantity assigned for a specific STO
export const getContractDetailsForSto = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumbers } = req.query;

    if (!sto) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number is required' },
      });
    }

    const contractList = contractNumbers ? String(contractNumbers).split(',').map(c => c.trim()).filter(Boolean) : [];

    // Ensure user_sto_contract_assignments table exists (it is created in updateStoQtyAssigned,
    // but that endpoint may not have been called yet on a fresh database)
    await query(`
      CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sto_number VARCHAR(255) NOT NULL,
        contract_number VARCHAR(255) NOT NULL,
        sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sto_number, contract_number)
      )
    `);

    // Get ALL contract numbers linked to this STO: column sto_number OR STO in raw/shipment/contract JSON
    const sapResult = await query(
      `SELECT DISTINCT contract_number FROM sap_processed_data
       WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
         AND (
           TRIM(COALESCE(sto_number::text, '')) = TRIM($1::text)
           OR NULLIF(TRIM(COALESCE(data->'raw'->>'STO No.', data->'raw'->>'STO Number', data->'shipment'->>'sto_no', data->'contract'->>'sto_no', data->>'STO No.', data->>'STO Number')), '') = TRIM($1::text)
         )`,
      [sto]
    );
    const sapContractNumbers = (sapResult.rows || []).map((r: { contract_number: string }) => r.contract_number);
    const allContractNumbers = [...new Set([...contractList, ...sapContractNumbers])].filter(Boolean);

    if (allContractNumbers.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Build one row per contract: use unnest so we include contracts that exist only in sap_processed_data (not in contracts table)
    const queryText = `
      WITH ac AS (SELECT unnest($2::text[]) AS contract_number)
      SELECT 
        ac.contract_number as contract_number,
        COALESCE(MAX(c.quantity_ordered), 0) as contract_qty,
        COALESCE(MAX(c.quantity_ordered), 0) - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = ac.contract_number
          AND spd.sto_number IS NOT NULL
          AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as outstanding_qty,
        COALESCE(
          (SELECT sto_qty_assigned FROM user_sto_contract_assignments 
           WHERE sto_number = $1 AND contract_number = ac.contract_number 
           LIMIT 1),
          (SELECT CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
           ORDER BY spd.created_at DESC
           LIMIT 1),
          0
        ) as sto_qty_assigned,
        (SELECT STRING_AGG(DISTINCT c2.po_number, ', ' ORDER BY c2.po_number) FILTER (WHERE c2.po_number IS NOT NULL AND c2.po_number != '')
         FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as po_number,
        (SELECT MAX(c2.delivery_start_date) FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as delivery_start_date,
        (SELECT MAX(c2.delivery_end_date) FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as delivery_end_date,
        COALESCE(
          (SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL),
          0
        ) as quantity_delivered,
        COALESCE(
          (SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL),
          0
        ) as quantity_receive
      FROM ac
      LEFT JOIN contracts c ON c.contract_id = ac.contract_number
      GROUP BY ac.contract_number
    `;

    const result = await query(queryText, [sto, allContractNumbers]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract details for STO error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract details' },
    });
  }
};

// Update STO quantity assigned for a contract (user input)
export const updateStoQtyAssigned = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumber, stoQtyAssigned } = req.body;

    if (!sto || !contractNumber || stoQtyAssigned === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number, contract number, and STO quantity assigned are required' },
      });
    }

    // Create table if it doesn't exist (for user input storage)
    await query(`
      CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sto_number VARCHAR(255) NOT NULL,
        contract_number VARCHAR(255) NOT NULL,
        sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sto_number, contract_number)
      )
    `);

    // Create update timestamp trigger if it doesn't exist
    await query(`
      CREATE OR REPLACE FUNCTION update_user_sto_contract_assignments_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await query(`
      DROP TRIGGER IF EXISTS update_user_sto_contract_assignments_updated_at ON user_sto_contract_assignments;
      CREATE TRIGGER update_user_sto_contract_assignments_updated_at
      BEFORE UPDATE ON user_sto_contract_assignments
      FOR EACH ROW EXECUTE FUNCTION update_user_sto_contract_assignments_updated_at();
    `);

    // Upsert the STO quantity assigned
    await query(`
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, sto_qty_assigned)
      VALUES ($1, $2, $3::numeric)
      ON CONFLICT (sto_number, contract_number)
      DO UPDATE SET 
        sto_qty_assigned = EXCLUDED.sto_qty_assigned,
        updated_at = CURRENT_TIMESTAMP
    `, [sto, contractNumber, parseFloat(String(stoQtyAssigned)) || 0]);

    return res.json({
      success: true,
      message: 'STO quantity assigned updated successfully',
    });
  } catch (error) {
    logger.error('Update STO quantity assigned error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update STO quantity assigned' },
    });
  }
};

export const createShipment = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      operationId,
      stoNumber, 
      contractNumbers, 
      contractQtyAssigned,
      vesselName, 
      vesselCode, 
      voyageNo, 
      vesselOwner,
      vesselDraft,
      vesselCapacity,
      vesselHullType,
      charterType,
      portOfLoading,
      portOfDischarge,
      quantityShipped,
      eta_arrival,
      eta_berthed,
      eta_loading_start,
      eta_loading_complete,
      eta_sailed,
      eta_discharge_arrival,
      eta_discharge_berthed,
      eta_discharge_start,
      eta_discharge_complete
    } = req.body;

    // Validate required fields - Contract Numbers are required, STO Number is optional
    if (!contractNumbers || !Array.isArray(contractNumbers) || contractNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'At least one Contract Number is required' },
      });
    }

    // For manual shipments, STO Number should be empty (will be filled from SAP Data later)
    // Only check STO if it's explicitly provided and not empty
    const hasStoNumber = stoNumber && stoNumber.trim() !== ''
    if (hasStoNumber) {
      const stoCheck = await query(`
        SELECT sto_number FROM contracts WHERE sto_number = $1 LIMIT 1
      `, [stoNumber]);

      if (stoCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: { message: `STO Number ${stoNumber} already exists. Please update the existing shipment instead of creating a new one.` },
        });
      }
    }

    // Validate that all contract numbers exist
    const contractCheck = await query(`
      SELECT contract_id, id FROM contracts 
      WHERE contract_id = ANY($1)
    `, [contractNumbers]);

    if (contractCheck.rows.length !== contractNumbers.length) {
      const foundContracts = contractCheck.rows.map(row => row.contract_id);
      const missingContracts = contractNumbers.filter(id => !foundContracts.includes(id));
      return res.status(400).json({
        success: false,
        error: { message: `The following contract numbers do not exist: ${missingContracts.join(', ')}` },
      });
    }

    // Create shipment for each contract
    // All shipments will share the same operation_id (one transaction)
    // If STO is not provided (manual shipment), operation_id is used as the grouping key in list queries.
    const shipmentIds = [];
    const timestamp = Date.now().toString()
    
    // Validate assigned qty sum <= vessel capacity (if provided)
    if (vesselCapacity != null && contractQtyAssigned && typeof contractQtyAssigned === 'object') {
      const cap = parseFloat(String(vesselCapacity))
      if (!Number.isNaN(cap)) {
        const sumAssigned = Object.values(contractQtyAssigned as Record<string, any>).reduce((sum: number, v: any) => {
          const n = parseFloat(String(v))
          return sum + (Number.isNaN(n) ? 0 : n)
        }, 0)
        if (sumAssigned > cap) {
          return res.status(400).json({
            success: false,
            error: { message: `Sum of "Contract Qty assign to STO" (${sumAssigned}) cannot exceed Vessel Capacity (${cap}).` },
          });
        }
      }
    }

    for (const contract of contractCheck.rows) {
      // Generate shipment_id:
      // - If STO is provided, use "<STO>-<CONTRACT_ID>" so all contracts under an STO can be grouped
      // - If STO is NOT provided (manual shipment), generate an internal unique id (do NOT mirror operation_id),
      //   and keep STO empty until it is updated from SAP.
      const shipmentId = hasStoNumber
        ? `${stoNumber}-${contract.contract_id}`
        : `MNL-${timestamp.slice(-8)}-${contract.contract_id}`;
      
      const result = await query(`
        INSERT INTO shipments (
          shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner,
          vessel_draft, vessel_capacity, vessel_hull_type, charter_type,
          port_of_loading, port_of_discharge, quantity_shipped,
          eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
          eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_discharge_complete,
          status
        ) VALUES (
          $1, $2, $3::uuid, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11,
          $12, $13, $14::numeric,
          $15::date, $16::date, $17::date, $18::date, $19::date,
          $20::date, $21::date, $22::date, $23::date,
          'PLANNED'
        ) RETURNING id
      `, [
        shipmentId,
        operationId || null,
        contract.id,
        vesselName || null,
        vesselCode || null,
        voyageNo || null,
        vesselOwner || null,
        vesselDraft ? parseFloat(String(vesselDraft)) : null,
        vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
        vesselHullType || null,
        charterType || null,
        portOfLoading || null,
        portOfDischarge || null,
        quantityShipped ? parseFloat(String(quantityShipped)) : null,
        eta_arrival || null,
        eta_berthed || null,
        eta_loading_start || null,
        eta_loading_complete || null,
        eta_sailed || null,
        eta_discharge_arrival || null,
        eta_discharge_berthed || null,
        eta_discharge_start || null,
        eta_discharge_complete || null
      ]);

      shipmentIds.push(result.rows[0].id);
    }

    // Persist user contract qty assignment (keyed by STO if exists; else operationId; else shipment_id)
    if (contractQtyAssigned && typeof contractQtyAssigned === 'object') {
      const assignmentKey = (hasStoNumber && stoNumber && String(stoNumber).trim())
        ? String(stoNumber).trim()
        : (operationId && String(operationId).trim())
          ? String(operationId).trim()
          : `MNL-${timestamp.slice(-8)}`;

      // Ensure table exists
      await query(`
        CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          sto_number VARCHAR(255) NOT NULL,
          contract_number VARCHAR(255) NOT NULL,
          sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(sto_number, contract_number)
        )
      `);

      for (const [contractNumber, qty] of Object.entries(contractQtyAssigned as Record<string, any>)) {
        if (!contractNumber) continue;
        const n = parseFloat(String(qty));
        await query(
          `
          INSERT INTO user_sto_contract_assignments (sto_number, contract_number, sto_qty_assigned)
          VALUES ($1, $2, $3::numeric)
          ON CONFLICT (sto_number, contract_number)
          DO UPDATE SET sto_qty_assigned = EXCLUDED.sto_qty_assigned, updated_at = CURRENT_TIMESTAMP
          `,
          [assignmentKey, String(contractNumber).trim(), Number.isNaN(n) ? 0 : n]
        );
      }
    }

    // Update contracts with STO number (only if STO is explicitly provided)
    // For manual shipments, STO remains empty and will be filled from SAP Data later
    if (hasStoNumber) {
      await query(`
        UPDATE contracts 
        SET sto_number = $1, updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = ANY($2)
      `, [stoNumber, contractNumbers]);
    }

    return res.json({
      success: true,
      message: stoNumber 
        ? `Shipment created successfully for STO ${stoNumber}`
        : `Shipment created successfully for contracts: ${contractNumbers.join(', ')}`,
      data: {
        stoNumber: stoNumber || null,
        contractNumbers,
        shipmentIds
      }
    });
  } catch (error: any) {
    logger.error('Create shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: error.message || 'Failed to create shipment',
        details: error.detail || error.toString()
      },
    });
  }
};
