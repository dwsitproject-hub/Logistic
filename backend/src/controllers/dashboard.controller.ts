import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

// Normalize query param to string[] (Express sends array for ?key=a&key=b)
const toFilterArray = (v: unknown): string[] => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && String(x).trim() !== '');
  const s = String(v).trim();
  return s ? [s] : [];
};

const plantSimilarity = (a: string, b: string): number => {
  const A = a.trim().replace(/\s+/g, ' ').toUpperCase();
  const B = b.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!A || !B) return A === B ? 1 : 0;
  if (A === B) return 1;
  const longer = A.length >= B.length ? A : B;
  const shorter = A.length >= B.length ? B : A;
  if (longer.includes(shorter) && shorter.length >= 4) return Math.min(1, Math.max(0.62, shorter.length / longer.length));
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = A[i - 1] === B[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
};

const ytdRange = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    dateFrom: `${yyyy}-01-01`,
    dateTo: `${yyyy}-${mm}-${dd}`,
  };
};

const shouldPerfLog = () => {
  const v = String(process.env.DASHBOARD_PERF_LOG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

/**
 * Exclude B2B "child" contracts from dashboard aggregates:
 * latest SAP row has B2B flag = B2B AND Contract Reff PO Ini (or mapped keys) is not blank.
 * Requires alias `c` for `contracts` (e.g. `FROM contracts c`). No bind parameters.
 */
const DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL = `
  AND COALESCE((
    SELECT NOT (
      UPPER(NULLIF(TRIM(COALESCE(
        x.data->'contract'->>'contract_type',
        x.data->>'B2B Flag',
        x.data->'raw'->>'B2B Flag',
        c.contract_type::text,
        ''
      )), '')) = 'B2B'
      AND NULLIF(TRIM(COALESCE(
        x.data->'contract'->>'contract_reference_po',
        x.data->>'CONTRACT REFF PO',
        x.data->>'Contract Reff PO Ini',
        x.data->'raw'->>'Contract Reff PO Ini',
        x.data->'raw'->>'CONTRACT REFF PO',
        ''
      )), '') IS NOT NULL
    )
    FROM sap_processed_data x
    WHERE x.contract_number = c.contract_id
    ORDER BY x.created_at DESC NULLS LAST
    LIMIT 1
  ), true)`;

const perf = (req: AuthRequest, name: string) => {
  const start = Date.now();
  const marks: Array<{ label: string; ms: number }> = [];
  const mark = (label: string) => {
    marks.push({ label, ms: Date.now() - start });
  };
  const done = () => {
    if (!shouldPerfLog()) return;
    const totalMs = Date.now() - start;
    logger.info('dashboard.perf', {
      route: name,
      totalMs,
      marks,
      userId: req.user?.id || null,
    });
  };
  return { mark, done };
};

// Helper function to build filter key (stable representation of filters for caching AI insights)
const buildFilterKey = (req: AuthRequest): { key: string; params: Record<string, unknown> } => {
  const { dateFrom, dateTo, plant, supplier, product, groupName, incoterm } = req.query;
  const ytd = ytdRange();
  const effDateFrom = dateFrom || ytd.dateFrom;
  const effDateTo = dateTo || ytd.dateTo;
  const filters = {
    dateFrom: effDateFrom || null,
    dateTo: effDateTo || null,
    plant: toFilterArray(plant),
    supplier: toFilterArray(supplier),
    product: toFilterArray(product),
    groupName: toFilterArray(groupName),
    incoterm: toFilterArray(incoterm),
  };
  // Stable JSON string as key
  const key = JSON.stringify(filters);
  return { key, params: filters };
};

// Helper function to build filter WHERE clauses (multi-value filters use OR)
const buildFilterConditions = (req: AuthRequest): { contractFilter: string; shipmentFilter: string; truckingFilter: string; params: any[] } => {
  const { dateFrom, dateTo, plant, supplier, product, groupName, incoterm } = req.query;
  const params: any[] = [];
  let paramIndex = 1;
  let contractFilter = '';
  let shipmentFilter = '';
  let truckingFilter = '';

  // Default to YTD when client does not provide a date filter (dashboard performance baseline).
  const ytd = ytdRange();
  const effDateFrom = dateFrom || ytd.dateFrom;
  const effDateTo = dateTo || ytd.dateTo;

  const plants = toFilterArray(plant);
  const suppliers = toFilterArray(supplier);
  const products = toFilterArray(product);
  const groups = toFilterArray(groupName);
  const incoterms = toFilterArray(incoterm);

  // Contract date range filter
  if (effDateFrom) {
    contractFilter += ` AND c.contract_date >= $${paramIndex}`;
    params.push(effDateFrom);
    paramIndex++;
  }
  if (effDateTo) {
    contractFilter += ` AND c.contract_date <= $${paramIndex}`;
    params.push(effDateTo);
    paramIndex++;
  }

  // Supplier filter (OR)
  if (suppliers.length > 0) {
    const placeholders = suppliers.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND c.supplier IN (${placeholders})`;
    params.push(...suppliers);
  }

  // Product filter (OR)
  if (products.length > 0) {
    const placeholders = products.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND c.product IN (${placeholders})`;
    params.push(...products);
  }

  // Group Name filter (OR)
  // Special token: "__UNGROUPED__" matches null/blank group_name.
  if (groups.length > 0) {
    const wantsUngrouped = groups.includes('__UNGROUPED__');
    const nonBlank = groups.filter((g) => g !== '__UNGROUPED__');
    const parts: string[] = [];
    if (nonBlank.length > 0) {
      const placeholders = nonBlank.map(() => `$${paramIndex++}`).join(', ');
      parts.push(`c.group_name IN (${placeholders})`);
      params.push(...nonBlank);
    }
    if (wantsUngrouped) {
      parts.push(`(c.group_name IS NULL OR TRIM(c.group_name) = '')`);
    }
    if (parts.length > 0) {
      contractFilter += ` AND (${parts.join(' OR ')})`;
    }
  }

  // Incoterm filter (OR) - normalized: Blank for null/empty
  if (incoterms.length > 0) {
    const placeholders = incoterms.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') IN (${placeholders})`;
    params.push(...incoterms);
  }

  // Plant/Site filter (OR: match any selected plant)
  if (plants.length > 0) {
    const blankIncluded = plants.includes('Blank');
    const nonBlank = plants.filter((p) => p !== 'Blank');
    const shipParts: string[] = [];
    const truckParts: string[] = [];
    const contractShipParts: string[] = [];
    const contractTruckParts: string[] = [];
    if (blankIncluded) {
      shipParts.push('(s.port_of_discharge IS NULL OR s.port_of_discharge = \'\')');
      truckParts.push('(t.location IS NULL OR t.location = \'\')');
      contractShipParts.push('(s.port_of_discharge IS NULL OR s.port_of_discharge = \'\')');
      contractTruckParts.push('(t.location IS NULL OR t.location = \'\')');
    }
    if (nonBlank.length > 0) {
      const ph = nonBlank.map(() => `$${paramIndex++}`).join(', ');
      shipParts.push(`s.port_of_discharge IN (${ph})`);
      truckParts.push(`t.location IN (${ph})`);
      contractShipParts.push(`s.port_of_discharge IN (${ph})`);
      contractTruckParts.push(`t.location IN (${ph})`);
      params.push(...nonBlank);
    }
    shipmentFilter = ` AND (${shipParts.join(' OR ')})`;
    truckingFilter = ` AND (${truckParts.join(' OR ')})`;
    contractFilter += ` AND (
      EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id AND (${contractShipParts.join(' OR ')}))
      OR EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = c.id AND (${contractTruckParts.join(' OR ')}))
    )`;
  }

  contractFilter += DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL;

  return { contractFilter, shipmentFilter, truckingFilter, params };
};

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const p = perf(req, 'GET /dashboard/stats');
    const { contractFilter, shipmentFilter, truckingFilter, params } = buildFilterConditions(req);
    
    // Get basic contract statistics (status derived from latest SAP data where available)
    const contractsStats = await query(`
      SELECT 
        COUNT(DISTINCT c.contract_id) as total_contracts,
        -- Fast path: rely on contracts.status (kept in sync by SAP distribution).
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            UPPER(COALESCE(c.status, '')) IN ('ACTIVE', 'OPEN')
        ) as open_contracts,
        -- Closed contracts
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            UPPER(COALESCE(c.status, '')) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
        ) as closed_contracts
      FROM contracts c
      WHERE 1=1 ${contractFilter}
    `, params);
    p.mark('contractsStats');

    // Open contract breakdown:
    // - outstanding_logistics: has shipment/trucking work not completed/cancelled yet
    // - outstanding_payment: has at least one payment with blank payoff_date
    const openBreakdownStats = await query(`
      WITH open_contracts AS (
        SELECT c.id, c.contract_id
        FROM contracts c
        WHERE 1=1 ${contractFilter}
          AND (
            UPPER(COALESCE(c.status, '')) IN ('OPEN', 'ACTIVE')
          )
      )
      SELECT
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM shipments s
            WHERE s.contract_id = oc.id
              AND UPPER(COALESCE(s.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
          )
          OR EXISTS (
            SELECT 1
            FROM trucking_operations t
            WHERE t.contract_id = oc.id
              AND UPPER(COALESCE(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
          )
        ) AS open_outstanding_logistics,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.contract_id = oc.id
              AND (p.payoff_date IS NULL OR TRIM(p.payoff_date::text) = '')
          )
        ) AS open_outstanding_payment
      FROM open_contracts oc
    `, params);
    p.mark('openBreakdownStats');

    // Quantity statistics across all contracts
    // Total Quantity = sum of contract quantities
    // Quantity Delivered = sum of STO quantities from sap_processed_data
    // Outstanding Quantity = Total Quantity - Quantity Delivered
    // Also break down delivered/outstanding by payoff status:
    // - paid: has at least one non-empty payoff_date
    // - outstanding payment: has at least one empty payoff_date
    const outstandingStats = await query(`
      WITH contract_qty AS (
        SELECT 
          c.id AS contract_pk,
          c.contract_id,
          MAX(c.quantity_ordered) AS contract_quantity,
          MAX(COALESCE(c.contract_value, 0)) AS contract_value,
          MAX(COALESCE(c.incoterm, '')) AS incoterm,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
              AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0) AS quantity_delivery,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
              AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0) AS quantity_receive,
          -- “Delivered quantity” for dashboard = the basis that drives Outstanding Quantity by Incoterm rule
          COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(MAX(c.incoterm), ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE((
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
              ), 0)
              WHEN UPPER(TRIM(COALESCE(MAX(c.incoterm), ''))) IN ('LCO', 'FOB') THEN COALESCE((
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
              ), 0)
              ELSE COALESCE((
                SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id 
                  AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
              ), 0)
            END,
            0
          ) AS delivered_quantity
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY c.id, c.contract_id
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payment_status = 'PAID' THEN 1 ELSE 0 END) AS has_paid,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      )
      SELECT 
        COALESCE(SUM(q.contract_quantity), 0) AS total_quantity,
        COALESCE(SUM(q.delivered_quantity), 0) AS delivered_quantity,
        -- Exclude over-delivery from outstanding totals (negative outstanding treated as 0)
        COALESCE(SUM(GREATEST(q.contract_quantity - q.delivered_quantity, 0)), 0) AS outstanding_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_paid, 0) = 1 THEN q.delivered_quantity ELSE 0 END), 0) AS delivered_paid_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN q.delivered_quantity ELSE 0 END), 0) AS delivered_pending_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_paid, 0) = 1 THEN GREATEST(q.contract_quantity - q.delivered_quantity, 0) ELSE 0 END), 0) AS outstanding_paid_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN GREATEST(q.contract_quantity - q.delivered_quantity, 0) ELSE 0 END), 0) AS outstanding_pending_quantity,
        COALESCE(SUM(CASE
          WHEN COALESCE(ps.has_blank_payoff, 0) = 1 AND q.contract_quantity > 0
          THEN (GREATEST(q.contract_quantity - q.delivered_quantity, 0)::numeric / NULLIF(q.contract_quantity::numeric, 0)) * q.contract_value::numeric
          ELSE 0
        END), 0) AS outstanding_pending_amount
      FROM contract_qty q
      LEFT JOIN payment_status_per_contract ps ON ps.contract_id = q.contract_pk
    `, params);
    p.mark('outstandingStats');

    // Outstanding claim quantities by PO number (latest Claim Mutu/Susut import).
    // Join key: contracts.po_number = claim_*_rows.po_number (as requested).
    //
    // Note: we intentionally do NOT apply the dashboard contract date filters here.
    // Applying contractFilter can exclude older contracts (YTD default) and zero out
    // claims that still exist in Claim Mutu/Susut uploads. We still use PO as FK by
    // restricting to POs that exist in `contracts`.
    const claimOutstandingStats = await query(
      `
      WITH filtered_pos AS (
        SELECT DISTINCT NULLIF(TRIM(c.po_number), '') AS po_number
        FROM contracts c
        WHERE NULLIF(TRIM(c.po_number), '') IS NOT NULL
      ),
      latest_mutu AS (
        SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      latest_susut AS (
        SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      mutu AS (
        SELECT
          COALESCE(SUM(COALESCE(r.qty_claim_kg, 0)), 0)::numeric AS qty,
          COALESCE(SUM(COALESCE(r.amount_after_tax_idr, 0)), 0)::numeric AS amount_idr
        FROM claim_mutu_rows r
        JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
        WHERE r.import_id = (SELECT id FROM latest_mutu)
          AND r.os_days IS NOT NULL
          AND r.os_days >= 0
      ),
      susut AS (
        SELECT
          COALESCE(SUM(COALESCE(r.qty_claim, 0)), 0)::numeric AS qty,
          COALESCE(SUM(COALESCE(r.amount_after_tax_idr, 0)), 0)::numeric AS amount_idr
        FROM claim_susut_rows r
        JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
        WHERE r.import_id = (SELECT id FROM latest_susut)
          AND r.os_days IS NOT NULL
          AND r.os_days >= 0
      )
      SELECT
        (SELECT qty FROM mutu) AS outstanding_claim_mutu_qty,
        (SELECT amount_idr FROM mutu) AS outstanding_claim_mutu_amount_idr,
        (SELECT qty FROM susut) AS outstanding_claim_susut_qty,
        (SELECT amount_idr FROM susut) AS outstanding_claim_susut_amount_idr
      `,
      [],
    );
    p.mark('claimOutstandingStats');

    // Get shipment statistics by status.
    // IMPORTANT: Use the same auto-status logic as Shipments update:
    // - If ATA ladder reaches COMPLETED, status = COMPLETED
    // - Else derive from ETA ladder
    // - Preserve CANCELLED from stored status
    const shipmentsStats = await query(
      `
      WITH ship_base AS (
        -- Match Shipments page universe: group by STO (SAP) or operation_id (manual)
        SELECT
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), ''), s.id::text) AS ship_key,
          MAX(NULLIF(TRIM(c.sto_number::text), '')) AS sto_number,
          MAX(NULLIF(TRIM(s.operation_id), '')) AS operation_id,
          MAX(NULLIF(TRIM(s.shipment_id), '')) AS shipment_id,
          MAX(UPPER(TRIM(COALESCE(s.status, '')))) AS stored_status,
          MAX(c.delivery_end_date) AS delivery_end_date,
          -- ATA ladder with vessel_loading_ports fallback (loading port seq=1, discharge port is_discharge_port=true)
          MAX(COALESCE(s.ata_arrival, (SELECT vlp1.ata_vessel_arrival::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_arrival,
          MAX(COALESCE(s.ata_berthed, (SELECT vlp1.ata_vessel_berthed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_berthed,
          MAX(COALESCE(s.ata_loading_start, (SELECT vlp1.ata_loading_start::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_loading_start,
          MAX(COALESCE(s.ata_loading_complete, (SELECT vlp1.ata_loading_completed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_loading_complete,
          MAX(COALESCE(s.ata_sailed, (SELECT vlp1.ata_vessel_sailed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_sailed,
          MAX(COALESCE(s.ata_discharge_arrival, (SELECT vlpd.ata_vessel_arrival::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_arrival,
          MAX(COALESCE(s.ata_discharge_berthed, (SELECT vlpd.ata_vessel_berthed::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_berthed,
          MAX(COALESCE(s.ata_discharge_start, (SELECT vlpd.ata_loading_start::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_start,
          MAX(COALESCE(s.ata_discharge_complete, (SELECT vlpd.ata_loading_completed::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_complete,
          -- ETA ladder (use shipment-level; dashboard performance baseline)
          MAX(s.eta_arrival) AS eta_arrival,
          MAX(s.eta_berthed) AS eta_berthed,
          MAX(s.eta_loading_start) AS eta_loading_start,
          MAX(s.eta_loading_complete) AS eta_loading_complete,
          MAX(s.eta_sailed) AS eta_sailed,
          MAX(s.eta_discharge_arrival) AS eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) AS eta_discharge_berthed,
          MAX(s.eta_discharge_start) AS eta_discharge_start,
          MAX(COALESCE(
            s.eta_discharge_complete,
            (SELECT vlpd.eta_vessel_complete_discharge::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1)
          )) AS eta_discharge_complete
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE 1=1 ${contractFilter} ${shipmentFilter}
        GROUP BY COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), ''), s.id::text)
      ),
      ship AS (
        SELECT
          sb.*,
          CASE
            WHEN sb.stored_status = 'CANCELLED' THEN 'CANCELLED'
            WHEN (
              sb.ata_arrival IS NOT NULL AND
              sb.ata_berthed IS NOT NULL AND
              sb.ata_loading_start IS NOT NULL AND
              sb.ata_loading_complete IS NOT NULL AND
              sb.ata_sailed IS NOT NULL AND
              sb.ata_discharge_arrival IS NOT NULL AND
              sb.ata_discharge_berthed IS NOT NULL AND
              sb.ata_discharge_start IS NOT NULL AND
              sb.ata_discharge_complete IS NOT NULL
            ) THEN 'COMPLETED'
            ELSE (
              CASE
                WHEN NOT (
                  sb.eta_arrival IS NOT NULL OR sb.eta_berthed IS NOT NULL OR sb.eta_loading_start IS NOT NULL OR sb.eta_loading_complete IS NOT NULL OR sb.eta_sailed IS NOT NULL
                  OR sb.eta_discharge_arrival IS NOT NULL OR sb.eta_discharge_berthed IS NOT NULL OR sb.eta_discharge_start IS NOT NULL OR sb.eta_discharge_complete IS NOT NULL
                ) THEN 'PLANNED'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                  AND sb.eta_discharge_arrival IS NOT NULL AND sb.eta_discharge_berthed IS NOT NULL
                ) THEN 'UNLOADING'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                  AND sb.eta_discharge_arrival IS NOT NULL
                ) THEN 'ARRIVED'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                ) THEN 'IN_TRANSIT'
                WHEN (sb.eta_arrival IS NOT NULL AND sb.eta_loading_start IS NOT NULL) THEN 'LOADING'
                WHEN (sb.eta_arrival IS NOT NULL) THEN 'IN_PROGRESS'
                ELSE 'PLANNED'
              END
            )
          END AS effective_status
        FROM ship_base sb
      )
      SELECT
        COUNT(*) as total_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'PLANNED') as planned_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'IN_PROGRESS') as in_progress_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'LOADING') as loading_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'IN_TRANSIT') as in_transit_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'ARRIVED') as arrived_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'UNLOADING') as unloading_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'COMPLETED') as completed_shipments,
        COUNT(*) FILTER (WHERE effective_status = 'CANCELLED') as cancelled_shipments,
        COUNT(*) FILTER (
          WHERE
            delivery_end_date IS NOT NULL
            AND (
              delivery_end_date::date < CURRENT_DATE
              OR (
                (ata_discharge_complete IS NOT NULL OR eta_discharge_complete IS NOT NULL)
                AND (
                  (ata_discharge_complete IS NOT NULL AND delivery_end_date::date < ata_discharge_complete::date)
                  OR (eta_discharge_complete IS NOT NULL AND delivery_end_date::date < eta_discharge_complete::date)
                )
              )
            )
        ) as late_shipments
      FROM ship
      `,
      params,
    );
    p.mark('shipmentsStats');

    // Get trucking operations statistics by status
    // Late = same logic as Trucking page: delivery_end vs eta_completion OR effective_actual_completion (on time if delivery_end >= either; else late)
    // effective_actual = COALESCE(t.trucking_completion_date, SAP "Trucking Last Receive Date") to match Trucking page
    const truckingStats = await query(`
      WITH trucking_contracts AS (
        SELECT DISTINCT c.contract_id
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE 1=1 ${contractFilter} ${truckingFilter}
          AND c.contract_id IS NOT NULL
      ),
      latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Trucking Last Receive Date', spd.data->>'Trucking Last Receive Date') AS last_receive_raw
        FROM sap_processed_data spd
        JOIN trucking_contracts tc ON tc.contract_id = spd.contract_number
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      latest_receive AS (
        SELECT
          contract_number,
          CASE
            WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
            WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
            WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
            ELSE NULL
          END AS trucking_last_receive_date
        FROM latest_spd
      ),
      trucking_with_completion AS (
        SELECT
          t.id,
          t.operation_id,
          t.status,
          t.eta_trucking_completion_date,
          c.delivery_end_date,
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(t.operation_id), ''), t.id::text) AS late_key,
          COALESCE(
            t.trucking_completion_date,
            lr.trucking_last_receive_date
          ) AS effective_completion_date
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        LEFT JOIN latest_receive lr ON lr.contract_number = c.contract_id
        WHERE 1=1 ${contractFilter} ${truckingFilter}
      )
      SELECT 
        COUNT(*) as total_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'PLANNED') as planned_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'LOADING') as loading_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'IN_TRANSIT') as in_transit_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'UNLOADING') as unloading_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled_trucking_operations,
        COUNT(DISTINCT late_key) FILTER (WHERE
          delivery_end_date IS NOT NULL
          AND (eta_trucking_completion_date IS NOT NULL OR effective_completion_date IS NOT NULL)
          AND NOT (
            (eta_trucking_completion_date IS NOT NULL AND delivery_end_date::date >= eta_trucking_completion_date::date)
            OR (effective_completion_date IS NOT NULL AND delivery_end_date::date >= effective_completion_date::date)
          )
        ) as late_trucking_operations
      FROM trucking_with_completion
    `, params);
    p.mark('truckingStats');

    // Get finance statistics aligned to contract value and payoff behavior
    const financeStats = await query(`
      WITH contract_payment AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff,
          MAX(CASE WHEN p.payoff_date IS NOT NULL THEN 1 ELSE 0 END) AS has_paid,
          MAX(CASE
            WHEN p.payoff_date IS NULL
                 AND p.payment_due_date IS NOT NULL
                 AND p.payment_due_date::date < CURRENT_DATE
              THEN 1
            WHEN p.payoff_date IS NOT NULL
                 AND p.payment_due_date IS NOT NULL
                 AND p.payoff_date::date > p.payment_due_date::date
              THEN 1
            ELSE 0
          END) AS has_late_payment
        FROM contracts c
        LEFT JOIN payments p ON p.contract_id = c.id
        WHERE 1=1 ${contractFilter}
        GROUP BY c.id, c.contract_id, c.contract_value
        HAVING COUNT(p.id) > 0
      )
      SELECT
        COUNT(*) AS total_payments,
        COUNT(*) FILTER (WHERE has_blank_payoff = 1) AS pending_payments,
        COUNT(*) FILTER (WHERE has_paid = 1) AS paid_payments,
        COUNT(*) FILTER (WHERE has_late_payment = 1) AS late_payments,
        COALESCE(SUM(contract_value), 0) AS total_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_blank_payoff = 1), 0) AS pending_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_paid = 1), 0) AS paid_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_late_payment = 1), 0) AS late_amount
      FROM contract_payment
    `, params);
    p.mark('financeStats');

    const cr = contractsStats.rows[0] || {};
    const or_ = outstandingStats.rows[0] || {};
    const sr = shipmentsStats.rows[0] || {};
    const tr = truckingStats.rows[0] || {};
    const fr = financeStats.rows[0] || {};
    const obr = openBreakdownStats.rows[0] || {};
    const cor = claimOutstandingStats.rows[0] || {};

    const stats = {
      contracts: {
        total: parseInt(cr.total_contracts) || 0,
        active: parseInt(cr.open_contracts) || 0,
        closed: parseInt(cr.closed_contracts) || 0,
        completed: 0,
        cancelled: 0,
        outstanding: parseInt(cr.open_contracts) || 0,
        openOutstandingLogistics: parseInt(obr.open_outstanding_logistics) || 0,
        openOutstandingPayment: parseInt(obr.open_outstanding_payment) || 0,
        totalQuantity: parseFloat(or_.total_quantity) || 0,
        deliveredQuantity: parseFloat(or_.delivered_quantity) || 0,
        outstandingQuantity: parseFloat(or_.outstanding_quantity) || 0,
        deliveredPaidQuantity: parseFloat(or_.delivered_paid_quantity) || 0,
        deliveredPendingQuantity: parseFloat(or_.delivered_pending_quantity) || 0,
        outstandingPaidQuantity: parseFloat(or_.outstanding_paid_quantity) || 0,
        outstandingPendingQuantity: parseFloat(or_.outstanding_pending_quantity) || 0,
        outstandingPendingAmount: parseFloat(or_.outstanding_pending_amount) || 0,
        outstandingClaimMutuQty: parseFloat(cor.outstanding_claim_mutu_qty) || 0,
        outstandingClaimSusutQty: parseFloat(cor.outstanding_claim_susut_qty) || 0,
        outstandingClaimMutuAmount: parseFloat(cor.outstanding_claim_mutu_amount_idr) || 0,
        outstandingClaimSusutAmount: parseFloat(cor.outstanding_claim_susut_amount_idr) || 0,
      },
      shipments: {
        total: parseInt(sr.total_shipments) || 0,
        planned: parseInt(sr.planned_shipments) || 0,
        inProgress: parseInt(sr.in_progress_shipments) || 0,
        loading: parseInt(sr.loading_shipments) || 0,
        inTransit: parseInt(sr.in_transit_shipments) || 0,
        arrived: parseInt(sr.arrived_shipments) || 0,
        unloading: parseInt(sr.unloading_shipments) || 0,
        completed: parseInt(sr.completed_shipments) || 0,
        cancelled: parseInt(sr.cancelled_shipments) || 0,
        late: parseInt(sr.late_shipments) || 0
      },
      trucking: {
        total: parseInt(tr.total_trucking_operations) || 0,
        planned: parseInt(tr.planned_trucking_operations) || 0,
        inProgress: parseInt(tr.in_progress_trucking_operations) || 0,
        loading: parseInt(tr.loading_trucking_operations) || 0,
        inTransit: parseInt(tr.in_transit_trucking_operations) || 0,
        unloading: parseInt(tr.unloading_trucking_operations) || 0,
        completed: parseInt(tr.completed_trucking_operations) || 0,
        cancelled: parseInt(tr.cancelled_trucking_operations) || 0,
        late: parseInt(tr.late_trucking_operations) || 0
      },
      finance: {
        total: parseInt(fr.total_payments) || 0,
        pending: parseInt(fr.pending_payments) || 0,
        paid: parseInt(fr.paid_payments) || 0,
        overdue: parseInt(fr.late_payments) || 0,
        totalAmount: parseFloat(fr.total_amount) || 0,
        pendingAmount: parseFloat(fr.pending_amount) || 0,
        paidAmount: parseFloat(fr.paid_amount) || 0,
        overdueAmount: parseFloat(fr.late_amount) || 0,
        revenue: parseFloat(fr.paid_amount) || 0
      }
    };

    p.done();
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'Failed to fetch dashboard statistics';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

/** Paginated Claim Mutu rows included in dashboard “outstanding” (latest import, OS days ≥ 0, PO exists in contracts). */
export const getClaimMutuOutstandingRows = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    const baseCte = `
      WITH filtered_pos AS (
        SELECT DISTINCT NULLIF(TRIM(c.po_number), '') AS po_number
        FROM contracts c
        WHERE NULLIF(TRIM(c.po_number), '') IS NOT NULL
      ),
      latest_mutu AS (
        SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      )`;

    const countRes = await query(
      `${baseCte}
      SELECT COUNT(*)::int AS c
      FROM claim_mutu_rows r
      JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
      WHERE r.import_id = (SELECT id FROM latest_mutu)
        AND r.os_days IS NOT NULL
        AND r.os_days >= 0`,
      []
    );

    const rowsRes = await query(
      `${baseCte}
      SELECT
        r.id,
        r.vendor_code,
        r.vendor_name,
        r.group_name,
        r.po_number,
        r.contract_ext_no,
        r.product,
        r.uom,
        r.currency,
        r.qty_claim_kg,
        r.amount_after_tax_idr,
        r.os_days,
        r.cr_date,
        r.crno
      FROM claim_mutu_rows r
      JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
      WHERE r.import_id = (SELECT id FROM latest_mutu)
        AND r.os_days IS NOT NULL
        AND r.os_days >= 0
      ORDER BY r.amount_after_tax_idr DESC NULLS LAST, r.po_number NULLS LAST
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      success: true,
      data: rowsRes.rows,
      meta: { totalCount: Number(countRes.rows[0]?.c) || 0 },
    });
  } catch (error) {
    logger.error('getClaimMutuOutstandingRows error:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to load claim mutu outstanding rows',
      },
    });
  }
};

/** Paginated Claim Susut rows included in dashboard “outstanding” (latest import, OS days ≥ 0, PO exists in contracts). */
export const getClaimSusutOutstandingRows = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    const baseCte = `
      WITH filtered_pos AS (
        SELECT DISTINCT NULLIF(TRIM(c.po_number), '') AS po_number
        FROM contracts c
        WHERE NULLIF(TRIM(c.po_number), '') IS NOT NULL
      ),
      latest_susut AS (
        SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      )`;

    const countRes = await query(
      `${baseCte}
      SELECT COUNT(*)::int AS c
      FROM claim_susut_rows r
      JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
      WHERE r.import_id = (SELECT id FROM latest_susut)
        AND r.os_days IS NOT NULL
        AND r.os_days >= 0`,
      []
    );

    const rowsRes = await query(
      `${baseCte}
      SELECT
        r.id,
        r.vendor_code,
        r.vendor_name,
        r.po_number,
        r.contract_ext_no,
        r.commodity,
        r.uom,
        r.currency,
        r.qty_claim,
        r.amount_after_tax_idr,
        r.os_days,
        r.cr_date,
        r.crno,
        r.type
      FROM claim_susut_rows r
      JOIN filtered_pos p ON p.po_number = NULLIF(TRIM(r.po_number), '')
      WHERE r.import_id = (SELECT id FROM latest_susut)
        AND r.os_days IS NOT NULL
        AND r.os_days >= 0
      ORDER BY r.amount_after_tax_idr DESC NULLS LAST, r.po_number NULLS LAST
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      success: true,
      data: rowsRes.rows,
      meta: { totalCount: Number(countRes.rows[0]?.c) || 0 },
    });
  } catch (error) {
    logger.error('getClaimSusutOutstandingRows error:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to load claim susut outstanding rows',
      },
    });
  }
};

// --- AI Insights (Gemini) ---

interface DashboardAiInsight {
  summary: string;
  highlights: string;
  recommendations: string;
}

const callGeminiForDashboardInsight = async (payload: unknown): Promise<DashboardAiInsight> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  const prompt = `
You are a senior logistics and supply chain expert for the **manufacturing industry**, specialized in **palm oil downstream** (oleochemicals, fats & oils, consumer products).

You are helping a logistics control tower interpret a dashboard that shows:
- Contracts (quantities, status, outstanding vs delivered, payment status).
- Shipments (sea logistics, late vs on-time).
- Trucking (land logistics, late vs on-time).
- Finance (payments, pending vs paid vs overdue).
- Product x Incoterm mix.
- Plant/Site distribution and performance.

TASK:
Given the JSON payload below (dashboard metrics + aggregates), produce:
1. **Summary**: 2–4 sentences describing the overall situation and recent performance.
2. **Highlights**: 3–7 concise bullet points (written as plain text lines, not with '-' characters) calling out key patterns, risks, or opportunities (e.g., late shipments to certain plants, high outstanding vs delivered, payment bottlenecks, unusual Incoterm mix).
3. **Recommendations**: 3–7 actionable recommendations from the perspective of a logistics manager in palm oil downstream manufacturing, aligned with best practices (e.g., shipment planning, trucking scheduling, supplier collaboration, port strategy, inventory buffers, contract structuring).

RULES:
- Focus on **palm oil downstream manufacturing logistics** (not generic supply chain).
- Be pragmatic and operational, not just descriptive.
- If data is limited or very balanced, say that briefly and still suggest sensible checks or improvements.
- NEVER invent specific numbers; only reference trends that are logically derivable (e.g., "outstanding is high compared to delivered", "late shipments are concentrated in LAND trucking").

Return your answer as **pure JSON** with this exact shape:
{
  "summary": "string",
  "highlights": "multiline string, each highlight on a new line",
  "recommendations": "multiline string, each recommendation on a new line"
}

Now here is the dashboard payload:
${JSON.stringify(payload, null, 2)}
`;

  const response = await fetch(
    // Use Gemini 2.5 Flash for dashboard insights
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    logger.error('Gemini API error:', { status: response.status, body: text });
    throw new Error('Failed to generate insight from Gemini');
  }

  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract first complete JSON object (brace-balanced) so we never store raw JSON in summary
  const extractJsonBlock = (s: string): string => {
    let raw = s.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    }
    const start = raw.indexOf('{');
    if (start === -1) return '';
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return raw.slice(start, raw.lastIndexOf('}') + 1);
  };

  const normalize = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x))).join('\n');
    return String(v);
  };

  let parsed: Partial<DashboardAiInsight> = {};
  const jsonBlock = extractJsonBlock(text);
  if (jsonBlock) {
    try {
      const obj = JSON.parse(jsonBlock) as Record<string, unknown>;
      parsed = {
        summary: normalize(obj.summary),
        highlights: normalize(obj.highlights),
        recommendations: normalize(obj.recommendations),
      };
    } catch {
      // leave parsed empty
    }
  }

  // Never put raw API text into summary; use parsed fields only or a safe message
  const summary = parsed.summary && !parsed.summary.trim().startsWith('{')
    ? parsed.summary
    : (parsed.summary || 'No summary generated.');
  return {
    summary,
    highlights: parsed.highlights ?? '',
    recommendations: parsed.recommendations ?? '',
  };
};

export const getDashboardAiInsight = async (req: AuthRequest, res: Response) => {
  try {
    const { key } = buildFilterKey(req);
    const result = await query(
      'SELECT summary, highlights, recommendations FROM dashboard_ai_insights WHERE filter_key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null,
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get dashboard AI insight error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load dashboard AI insight' },
    });
  }
};

export const generateDashboardAiInsight = async (req: AuthRequest, res: Response) => {
  try {
    const { key, params } = buildFilterKey(req);
    const payload = {
      filters: params,
      // Frontend may optionally send rich dashboard data to include in the prompt
      dashboard: req.body?.dashboard ?? null,
    };

    const insight = await callGeminiForDashboardInsight(payload);

    const upsertQuery = `
      INSERT INTO dashboard_ai_insights (filter_key, filter_params, summary, highlights, recommendations, model_provider, model_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (filter_key) DO UPDATE
      SET summary = EXCLUDED.summary,
          highlights = EXCLUDED.highlights,
          recommendations = EXCLUDED.recommendations,
          model_provider = EXCLUDED.model_provider,
          model_name = EXCLUDED.model_name,
          updated_at = CURRENT_TIMESTAMP
      RETURNING summary, highlights, recommendations
    `;

    const upsertResult = await query(upsertQuery, [
      key,
      JSON.stringify(params),
      insight.summary,
      insight.highlights,
      insight.recommendations,
      'gemini',
      'gemini-2.5-flash',
    ]);

    return res.json({
      success: true,
      data: upsertResult.rows[0],
    });
  } catch (error: any) {
    logger.error('Generate dashboard AI insight error:', error);
    const message =
      error?.message === 'GEMINI_API_KEY is not configured on the server'
        ? error.message
        : 'Failed to generate dashboard AI insight';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

export const getTopSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        c.supplier,
        COUNT(DISTINCT c.contract_id) as contract_count,
        SUM(c.quantity_ordered) as total_quantity,
        AVG(c.unit_price) as avg_unit_price,
        SUM(c.contract_value) as total_contract_value
      FROM contracts c
      WHERE c.supplier IS NOT NULL AND c.supplier != '' ${contractFilter}
      GROUP BY c.supplier
      ORDER BY total_quantity DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top suppliers' },
    });
  }
};

export const getTopTruckingOwners = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, truckingFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        t.trucking_owner,
        COUNT(*) as operation_count,
        SUM(t.quantity_sent) as total_quantity_sent,
        SUM(t.quantity_delivered) as total_quantity_delivered,
        AVG(t.gain_loss_percentage) as avg_gain_loss_percentage,
        SUM(t.oa_actual) as total_oa_actual
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE t.trucking_owner IS NOT NULL AND t.trucking_owner != '' ${contractFilter} ${truckingFilter}
      GROUP BY t.trucking_owner
      ORDER BY total_quantity_sent DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top trucking owners error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top trucking owners' },
    });
  }
};

export const getTopVessels = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        s.vessel_name,
        COUNT(*) as shipment_count,
        SUM(s.quantity_shipped) as total_quantity_shipped,
        SUM(s.quantity_delivered) as total_quantity_delivered,
        AVG(s.gain_loss_percentage) as avg_gain_loss_percentage,
        COUNT(*) FILTER (WHERE s.is_delayed = true) as delayed_count
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE s.vessel_name IS NOT NULL AND s.vessel_name != '' ${contractFilter} ${shipmentFilter}
      GROUP BY s.vessel_name
      ORDER BY total_quantity_shipped DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top vessels error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top vessels' },
    });
  }
};

export const getDashboardOverview = async (req: AuthRequest, res: Response) => {
  try {
    const includeManagement = String((req.query as any).includeManagement || '').toLowerCase() === 'true';
    const { contractFilter, params } = buildFilterConditions(req);

    // Consolidate the heavy widgets into ONE query so we scan sap_processed_data only once.
    const widgetsCombined = await query(
      `
      WITH filtered_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.product,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          c.unit_price,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_location
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE c.product IS NOT NULL AND TRIM(c.product) != '' ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0)::numeric AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0)::numeric AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0)::numeric AS total_sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      ),
      enriched AS (
        SELECT
          fc.*,
          COALESCE(db.quantity_receive, 0) AS quantity_receive,
          COALESCE(db.quantity_delivery, 0) AS quantity_delivery,
          COALESCE(db.total_sto_quantity, 0) AS total_sto_quantity,
          COALESCE(ps.has_blank_payoff, 0) AS has_blank_payoff
        FROM filtered_contracts fc
        LEFT JOIN delivered_by_contract db ON db.contract_id = fc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = fc.contract_pk
      ),
      product_incoterm AS (
        SELECT
          e.product,
          e.incoterm,
          COUNT(DISTINCT e.contract_id) AS contract_count,
          COUNT(DISTINCT e.supplier) AS supplier_count,
          SUM(e.quantity_ordered) AS total_quantity,
          SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
              ELSE e.total_sto_quantity
            END
          ) AS completed_quantity,
          COALESCE(SUM(GREATEST(
            e.quantity_ordered - (
              CASE
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
                ELSE e.total_sto_quantity
              END
            ),
            0
          )), 0) AS outstanding_quantity,
          SUM(
            CASE
              WHEN e.has_blank_payoff = 1
              THEN GREATEST(
                e.quantity_ordered - (
                  CASE
                    WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
                    WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
                    ELSE e.total_sto_quantity
                  END
                ),
                0
              )
              ELSE 0
            END
          ) AS outstanding_payment_quantity,
          AVG(e.unit_price) AS avg_unit_price,
          SUM(e.contract_value) AS total_contract_value
        FROM enriched e
        GROUP BY e.product, e.incoterm
      ),
      plant_incoterm AS (
        SELECT
          e.plant_location,
          e.incoterm,
          COUNT(DISTINCT e.contract_id) AS contract_count,
          COUNT(DISTINCT e.supplier) AS supplier_count,
          SUM(e.quantity_ordered) AS total_quantity,
          SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
              ELSE e.total_sto_quantity
            END
          ) AS completed_quantity,
          COALESCE(SUM(GREATEST(
            e.quantity_ordered - (
              CASE
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
                ELSE e.total_sto_quantity
              END
            ),
            0
          )), 0) AS outstanding_quantity,
          SUM(
            CASE
              WHEN e.has_blank_payoff = 1
              THEN GREATEST(
                e.quantity_ordered - (
                  CASE
                    WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
                    WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
                    ELSE e.total_sto_quantity
                  END
                ),
                0
              )
              ELSE 0
            END
          ) AS outstanding_payment_quantity
        FROM enriched e
        GROUP BY e.plant_location, e.incoterm
      ),
      plant_qty AS (
        SELECT
          e.plant_location,
          COUNT(DISTINCT e.contract_id)::int AS contract_count,
          COALESCE(SUM(e.quantity_ordered), 0)::numeric AS total_quantity,
          COALESCE(SUM(LEAST(
            e.quantity_ordered,
            CASE
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
              WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
              ELSE e.total_sto_quantity
            END
          )), 0)::numeric AS total_quantity_delivered,
          COALESCE(SUM(GREATEST(
            e.quantity_ordered - LEAST(
              e.quantity_ordered,
              CASE
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN e.quantity_receive
                WHEN UPPER(TRIM(COALESCE(e.incoterm, ''))) IN ('LCO', 'FOB') THEN e.quantity_delivery
                ELSE e.total_sto_quantity
              END
            ),
            0
          )), 0)::numeric AS total_quantity_shipped,
          COALESCE(SUM(e.contract_value), 0)::numeric AS total_contract_value,
          COUNT(DISTINCT e.supplier)::int AS supplier_count
        FROM enriched e
        GROUP BY e.plant_location
        ORDER BY total_quantity DESC
        LIMIT 10
      )
      SELECT
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.product, x.total_quantity DESC NULLS LAST, x.incoterm) FROM product_incoterm x),
          '[]'::jsonb
        ) AS product_incoterm_rows,
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.plant_location, x.total_quantity DESC NULLS LAST, x.incoterm) FROM plant_incoterm x),
          '[]'::jsonb
        ) AS plant_incoterm_rows,
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total_quantity DESC NULLS LAST) FROM plant_qty x),
          '[]'::jsonb
        ) AS plant_quantities
      `,
      params
    );

    const [
      topSuppliers,
      topTruckingOwners,
      topVessels,
      plantsOpt,
      suppliersOpt,
      productsOpt,
      groupsOpt,
      mgmtBreakdown,
    ] = await Promise.all([
      // top performers
      query(
        `
        SELECT 
          c.supplier,
          COUNT(DISTINCT c.contract_id) as contract_count,
          SUM(c.quantity_ordered) as total_quantity,
          AVG(c.unit_price) as avg_unit_price,
          SUM(c.contract_value) as total_contract_value
        FROM contracts c
        WHERE c.supplier IS NOT NULL AND c.supplier != '' ${contractFilter}
        GROUP BY c.supplier
        ORDER BY total_quantity DESC
        LIMIT 5
        `,
        params
      ),
      query(
        `
        SELECT 
          t.trucking_owner,
          COUNT(*) as operation_count,
          SUM(t.quantity_sent) as total_quantity_sent,
          SUM(t.quantity_delivered) as total_quantity_delivered,
          AVG(t.gain_loss_percentage) as avg_gain_loss_percentage,
          SUM(t.oa_actual) as total_oa_actual
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE t.trucking_owner IS NOT NULL AND t.trucking_owner != '' ${contractFilter}
        GROUP BY t.trucking_owner
        ORDER BY total_quantity_sent DESC
        LIMIT 5
        `,
        params
      ),
      query(
        `
        SELECT 
          s.vessel_name,
          COUNT(*) as shipment_count,
          SUM(s.quantity_shipped) as total_quantity_shipped,
          SUM(s.quantity_delivered) as total_quantity_delivered,
          AVG(s.gain_loss_percentage) as avg_gain_loss_percentage,
          COUNT(*) FILTER (WHERE s.is_delayed = true) as delayed_count
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.vessel_name IS NOT NULL AND s.vessel_name != '' ${contractFilter}
        GROUP BY s.vessel_name
        ORDER BY total_quantity_shipped DESC
        LIMIT 5
        `,
        params
      ),
      // filter options (unfiltered, fast)
      query(
        `
        SELECT DISTINCT plant_location
        FROM (
          SELECT 
            CASE 
              WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
              ELSE s.port_of_discharge
            END as plant_location
          FROM shipments s
          UNION
          SELECT 
            CASE 
              WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
              ELSE t.location
            END as plant_location
          FROM trucking_operations t
        ) plants
        WHERE plant_location IS NOT NULL
        ORDER BY plant_location
        `
      ),
      query(
        `
        SELECT DISTINCT supplier
        FROM contracts
        WHERE supplier IS NOT NULL AND supplier != ''
        ORDER BY supplier
        `
      ),
      query(
        `
        SELECT DISTINCT product
        FROM contracts
        WHERE product IS NOT NULL AND product != ''
        ORDER BY product
        `
      ),
      query(
        `
        SELECT DISTINCT COALESCE(NULLIF(TRIM(group_name), ''), 'Blank') AS group_name
        FROM contracts
        WHERE group_name IS NOT NULL OR group_name = ''
        ORDER BY group_name
        `
      ),
      includeManagement
        ? query(
            `
            WITH base_contracts AS (
              SELECT
                c.id AS contract_pk,
                c.contract_id,
                c.product,
                COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
                c.supplier,
                COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
                c.unit_price,
                c.contract_value,
                COALESCE(NULLIF(TRIM(c.source_type), ''), 'Blank') AS source_type,
                COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text, 'Blank') AS lt_spot,
                COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
              FROM contracts c
              LEFT JOIN LATERAL (
                SELECT data FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                ORDER BY spd.created_at DESC NULLS LAST
                LIMIT 1
              ) l ON true
              LEFT JOIN LATERAL (
                SELECT UPPER(TRIM(COALESCE(
                  NULLIF(TRIM(c.transport_mode), ''),
                  (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
                   WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
                  (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
                   WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
                  ''
                ))) AS tm_upper
              ) tx ON true
              LEFT JOIN LATERAL (
                SELECT COALESCE(
                  CASE
                    WHEN tx.tm_upper LIKE 'LAND%' THEN (
                      SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                      FROM trucking_operations t
                      WHERE t.contract_id = c.id
                      ORDER BY t.created_at DESC NULLS LAST
                      LIMIT 1
                    )
                    WHEN tx.tm_upper LIKE 'SEA%' THEN (
                      SELECT NULLIF(TRIM(s.port_of_discharge), '')
                      FROM shipments s
                      WHERE s.contract_id = c.id
                      ORDER BY s.created_at DESC NULLS LAST
                      LIMIT 1
                    )
                    ELSE NULL
                  END,
                  NULLIF(TRIM(c.unloading_site), ''),
                  NULLIF(TRIM(c.loading_site), '')
                ) AS plant_site
              ) ps ON true
              WHERE c.product IS NOT NULL AND TRIM(c.product) != '' ${contractFilter}
            )
            SELECT
              product,
              incoterm,
              plant_site,
              source_type,
              lt_spot,
              COUNT(DISTINCT contract_id) AS contract_count,
              COUNT(DISTINCT supplier) AS supplier_count,
              SUM(quantity_ordered) AS total_quantity,
              AVG(unit_price) AS avg_unit_price,
              SUM(contract_value) AS total_contract_value
            FROM base_contracts
            GROUP BY product, incoterm, plant_site, source_type, lt_spot
            ORDER BY product, total_quantity DESC NULLS LAST, incoterm, plant_site, source_type, lt_spot
            `,
            params
          )
        : Promise.resolve({ rows: [] } as any),
    ]);

    return res.json({
      success: true,
      data: {
        topSuppliers: topSuppliers.rows,
        topTruckingOwners: topTruckingOwners.rows,
        topVessels: topVessels.rows,
        productIncotermRows: (widgetsCombined.rows?.[0]?.product_incoterm_rows as any[]) || [],
        plantIncotermRows: (widgetsCombined.rows?.[0]?.plant_incoterm_rows as any[]) || [],
        plantQuantities: (widgetsCombined.rows?.[0]?.plant_quantities as any[]) || [],
        filterOptions: {
          plants: plantsOpt.rows.map((r: any) => r.plant_location),
          suppliers: suppliersOpt.rows.map((r: any) => r.supplier),
          products: productsOpt.rows.map((r: any) => r.product),
          groups: groupsOpt.rows.map((r: any) => r.group_name),
        },
        management: includeManagement ? { productIncotermPlantSourceRows: mgmtBreakdown.rows } : undefined,
      },
    });
  } catch (error) {
    logger.error('Get dashboard overview error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch dashboard overview' },
    });
  }
};

export const getContractsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    const { contractFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    let queryText = `
      SELECT 
        c.contract_id,
        c.supplier,
        c.buyer,
        c.product,
        c.quantity_ordered,
        c.unit,
        c.contract_value,
        c.currency,
        c.status,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date
      FROM contracts c
      WHERE 1=1 ${contractFilter}
    `;
    const finalParams: any[] = [...params];

    if (status) {
      queryText += ` AND c.status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY c.contract_date DESC LIMIT $${paramIndex}`;
    finalParams.push(limit);

    const result = await query(queryText, finalParams);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contracts by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contracts' },
    });
  }
};

export const getShipmentsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, delayed } = req.query as { status?: string; delayed?: string };
    const statusNorm = String(status || '').trim().toUpperCase();
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    // Reuse dashboard filter conditions
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    const finalParams: any[] = [...params];

    const wantsStatus = Boolean(status && statusNorm);
    const wantsStatusValue = statusNorm;
    let baseFilterSql = '';
    if (wantsStatus) {
      baseFilterSql += ` AND status = $${paramIndex}`;
      finalParams.push(wantsStatusValue);
      paramIndex++;
    }
    if (delayed === 'true') {
      baseFilterSql += ` AND late_indicator = 'Late'`;
    }
    // NOTE: Drilldown must match the same universe/status logic as Shipment Performance stats:
    // group by STO/operation and use vessel_loading_ports fallback for ATA ladder.
    const queryText = `
      WITH ship_base AS (
        SELECT
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), ''), s.id::text) AS ship_key,
          (array_agg(s.id ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL))[1] AS id,
          MAX(NULLIF(TRIM(c.sto_number::text), '')) AS sto_number,
          MAX(NULLIF(TRIM(s.operation_id), '')) AS operation_id,
          MAX(NULLIF(TRIM(s.shipment_id), '')) AS shipment_id,
          MAX(s.vessel_name) AS vessel_name,
          MAX(s.port_of_loading) AS port_of_loading,
          MAX(s.port_of_discharge) AS port_of_discharge,
          MAX(c.contract_id) AS contract_id,
          MAX(c.supplier) AS supplier,
          MAX(c.product) AS product,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(UPPER(TRIM(COALESCE(s.status, '')))) AS stored_status,
          MAX(COALESCE(s.ata_discharge_complete, (SELECT vlpd.ata_loading_completed::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_complete,
          MAX(COALESCE(
            s.eta_discharge_complete,
            (SELECT vlpd.eta_vessel_complete_discharge::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1)
          )) AS eta_discharge_complete,
          MAX(COALESCE(s.ata_arrival, (SELECT vlp1.ata_vessel_arrival::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_arrival,
          MAX(COALESCE(s.ata_berthed, (SELECT vlp1.ata_vessel_berthed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_berthed,
          MAX(COALESCE(s.ata_loading_start, (SELECT vlp1.ata_loading_start::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_loading_start,
          MAX(COALESCE(s.ata_loading_complete, (SELECT vlp1.ata_loading_completed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_loading_complete,
          MAX(COALESCE(s.ata_sailed, (SELECT vlp1.ata_vessel_sailed::date FROM vessel_loading_ports vlp1 WHERE vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false LIMIT 1))) AS ata_sailed,
          MAX(COALESCE(s.ata_discharge_arrival, (SELECT vlpd.ata_vessel_arrival::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_arrival,
          MAX(COALESCE(s.ata_discharge_berthed, (SELECT vlpd.ata_vessel_berthed::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_berthed,
          MAX(COALESCE(s.ata_discharge_start, (SELECT vlpd.ata_loading_start::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) AS ata_discharge_start,
          MAX(s.eta_arrival) AS eta_arrival,
          MAX(s.eta_berthed) AS eta_berthed,
          MAX(s.eta_loading_start) AS eta_loading_start,
          MAX(s.eta_loading_complete) AS eta_loading_complete,
          MAX(s.eta_sailed) AS eta_sailed,
          MAX(s.eta_discharge_arrival) AS eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) AS eta_discharge_berthed,
          MAX(s.eta_discharge_start) AS eta_discharge_start
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE 1=1 ${contractFilter} ${shipmentFilter}
        GROUP BY COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), ''), s.id::text)
      ),
      base AS (
        SELECT
          sb.*,
          CASE
            WHEN sb.stored_status = 'CANCELLED' THEN 'CANCELLED'
            WHEN (
              sb.ata_arrival IS NOT NULL AND
              sb.ata_berthed IS NOT NULL AND
              sb.ata_loading_start IS NOT NULL AND
              sb.ata_loading_complete IS NOT NULL AND
              sb.ata_sailed IS NOT NULL AND
              sb.ata_discharge_arrival IS NOT NULL AND
              sb.ata_discharge_berthed IS NOT NULL AND
              sb.ata_discharge_start IS NOT NULL AND
              sb.ata_discharge_complete IS NOT NULL
            ) THEN 'COMPLETED'
            ELSE (
              CASE
                WHEN NOT (
                  sb.eta_arrival IS NOT NULL OR sb.eta_berthed IS NOT NULL OR sb.eta_loading_start IS NOT NULL OR sb.eta_loading_complete IS NOT NULL OR sb.eta_sailed IS NOT NULL
                  OR sb.eta_discharge_arrival IS NOT NULL OR sb.eta_discharge_berthed IS NOT NULL OR sb.eta_discharge_start IS NOT NULL OR sb.eta_discharge_complete IS NOT NULL
                ) THEN 'PLANNED'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                  AND sb.eta_discharge_arrival IS NOT NULL AND sb.eta_discharge_berthed IS NOT NULL
                ) THEN 'UNLOADING'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                  AND sb.eta_discharge_arrival IS NOT NULL
                ) THEN 'ARRIVED'
                WHEN (
                  sb.eta_arrival IS NOT NULL AND sb.eta_berthed IS NOT NULL AND sb.eta_loading_start IS NOT NULL AND sb.eta_loading_complete IS NOT NULL AND sb.eta_sailed IS NOT NULL
                ) THEN 'IN_TRANSIT'
                WHEN (sb.eta_arrival IS NOT NULL AND sb.eta_loading_start IS NOT NULL) THEN 'LOADING'
                WHEN (sb.eta_arrival IS NOT NULL) THEN 'IN_PROGRESS'
                ELSE 'PLANNED'
              END
            )
          END AS status,
          CASE
            WHEN sb.delivery_end_date IS NULL THEN '-'
            WHEN (
              sb.delivery_end_date::date < CURRENT_DATE
              OR (
                (sb.ata_discharge_complete IS NOT NULL OR sb.eta_discharge_complete IS NOT NULL)
                AND (
                  (sb.ata_discharge_complete IS NOT NULL AND sb.delivery_end_date::date < sb.ata_discharge_complete::date)
                  OR (sb.eta_discharge_complete IS NOT NULL AND sb.delivery_end_date::date < sb.eta_discharge_complete::date)
                )
              )
            ) THEN 'Late'
            ELSE 'On Time'
          END AS late_indicator
        FROM ship_base sb
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM base WHERE 1=1 ${baseFilterSql}
      ),
      paged AS (
        SELECT *
        FROM base
        WHERE 1=1 ${baseFilterSql}
        ORDER BY delivery_end_date DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);

    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Plant summary for full filtered payment scope (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get shipments by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipments' },
    });
  }
};

export const getTruckingOperationsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const statusNorm = String(status || '').trim().toUpperCase();
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const { contractFilter, truckingFilter, params } = buildFilterConditions(req);
    const finalParams: any[] = [...params];
    let paramIndex = params.length + 1;

    // When filtering for LATE, use same logic as Trucking page (effective_completion = COALESCE(t.trucking_completion_date, SAP Trucking Last Receive Date))
    const useLateFilter = status === 'LATE';
    const statusFilterSql = status && !useLateFilter ? ` AND t.status = $${paramIndex}` : '';
    if (status && !useLateFilter) {
      finalParams.push(status);
      paramIndex++;
    }

    const baseWhere = `1=1 ${contractFilter} ${truckingFilter}${statusFilterSql}`;

    const queryText = `
      WITH trucking_with_completion AS (
        SELECT
          t.id,
          t.operation_id,
          t.location,
          t.trucking_owner,
          t.status,
          t.quantity_sent,
          t.quantity_delivered,
          t.gain_loss_percentage,
          t.created_at,
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          c.delivery_end_date,
          t.eta_trucking_completion_date,
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(t.operation_id), ''), t.id::text) AS late_key,
          COALESCE(
            t.trucking_completion_date,
            (
              SELECT (CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                ELSE NULL
              END)
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Trucking Last Receive Date', spd.data->>'Trucking Last Receive Date') AS val
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                ORDER BY spd.created_at DESC NULLS LAST
                LIMIT 1
              ) v
              WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
            )
          ) AS effective_completion_date,
          (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS contract_ext_no
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE ${baseWhere}
      ),
      base AS (
        ${useLateFilter ? `
        SELECT DISTINCT ON (late_key)
          id,
          operation_id,
          location,
          trucking_owner,
          status,
          quantity_sent,
          quantity_delivered,
          gain_loss_percentage,
          created_at,
          contract_id,
          sto_number,
          supplier,
          product,
          contract_ext_no
        FROM trucking_with_completion
        WHERE
          delivery_end_date IS NOT NULL
          AND (eta_trucking_completion_date IS NOT NULL OR effective_completion_date IS NOT NULL)
          AND NOT (
            (eta_trucking_completion_date IS NOT NULL AND delivery_end_date::date >= eta_trucking_completion_date::date)
            OR (effective_completion_date IS NOT NULL AND delivery_end_date::date >= effective_completion_date::date)
          )
        ORDER BY late_key, created_at DESC NULLS LAST, id DESC
        ` : `
        SELECT
          id,
          operation_id,
          location,
          trucking_owner,
          status,
          quantity_sent,
          quantity_delivered,
          gain_loss_percentage,
          created_at,
          contract_id,
          sto_number,
          supplier,
          product,
          contract_ext_no
        FROM trucking_with_completion
        WHERE 1=1
        `}
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM base
      ),
      paged AS (
        SELECT *
        FROM base
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);

    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Plant summary for full filtered payment scope (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get trucking operations by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch trucking operations' },
    });
  }
};

export const getPaymentsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, plantSite } = req.query as { status?: string; plantSite?: string };
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const { contractFilter, params } = buildFilterConditions(req);
    const finalParams: any[] = [...params];
    let paramIndex = params.length + 1;

    let statusFilterSql = '';
    const statusNorm = String(status || '').trim().toUpperCase();
    if (statusNorm === 'PENDING_PAYMENT') {
      statusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'PAID_PAYMENT') {
      statusFilterSql = ` AND (p.payoff_date IS NOT NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      statusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      statusFilterSql = ` AND p.payment_status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }
    const plantSiteFilterSql = plantSite ? ` AND UPPER(COALESCE(plant_site, 'Blank')) = UPPER($${paramIndex})` : '';
    if (plantSite) {
      finalParams.push(String(plantSite));
      paramIndex++;
    }

    const queryText = `
      WITH base AS (
        SELECT
          p.id,
          c.contract_id,
          c.po_number,
          c.sto_number,
          COALESCE(
            (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
             FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id
             ORDER BY spd.created_at DESC NULLS LAST
             LIMIT 1),
            NULL
          ) AS contract_ext_no,
          c.unit_price,
          c.contract_value,
          c.group_name,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site,
          p.invoice_number,
          p.invoice_date,
          p.payment_amount,
          p.currency,
          p.payment_status,
          p.payment_due_date,
          p.dp_date,
          p.payoff_date,
          p.payment_date,
          -- Deviations in days (positive = late)
          CASE
            WHEN p.payment_due_date IS NULL OR p.dp_date IS NULL THEN NULL
            ELSE (p.dp_date::date - p.payment_due_date::date)
          END AS dp_date_deviation_days,
          CASE
            WHEN p.payment_due_date IS NULL OR p.payoff_date IS NULL THEN NULL
            ELSE (p.payoff_date::date - p.payment_due_date::date)
          END AS payoff_date_deviation_days
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                  AND COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), '')) IS NOT NULL
                  AND TRIM(COALESCE(t.unloading_location, t.location, '')) <> ''
                  AND UPPER(TRIM(COALESCE(t.unloading_location, t.location, ''))) <> 'N/A'
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                  AND s.port_of_discharge IS NOT NULL
                  AND TRIM(s.port_of_discharge) <> ''
                  AND UPPER(TRIM(s.port_of_discharge)) <> 'N/A'
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            (
              SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
              FROM trucking_operations t
              WHERE t.contract_id = c.id
                AND COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), '')) IS NOT NULL
                AND TRIM(COALESCE(t.unloading_location, t.location, '')) <> ''
                AND UPPER(TRIM(COALESCE(t.unloading_location, t.location, ''))) <> 'N/A'
              ORDER BY t.created_at DESC NULLS LAST
              LIMIT 1
            ),
            (
              SELECT NULLIF(TRIM(s.port_of_discharge), '')
              FROM shipments s
              WHERE s.contract_id = c.id
                AND s.port_of_discharge IS NOT NULL
                AND TRIM(s.port_of_discharge) <> ''
                AND UPPER(TRIM(s.port_of_discharge)) <> 'N/A'
              ORDER BY s.created_at DESC NULLS LAST
              LIMIT 1
            ),
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${statusFilterSql}
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1 ${plantSiteFilterSql}
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM filtered
      ),
      paged AS (
        SELECT *
        FROM filtered
        ORDER BY payment_due_date DESC NULLS LAST, invoice_date DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);
    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Full-scope plant summary for this payment filter (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'PAID_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NOT NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get payments by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch payments' },
    });
  }
};

// Get contract quantity by product materials
export const getContractQuantityByProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        product,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity as outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT 
          c.product,
          COUNT(DISTINCT c.contract_id) as contract_count,
          SUM(c.quantity_ordered) as total_quantity,
          COALESCE(SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(q.quantity_receive, 0)
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(q.quantity_delivery, 0)
              ELSE COALESCE(q.total_sto_quantity, 0)
            END
          ), 0) as completed_quantity,
          AVG(c.unit_price) as avg_unit_price,
          SUM(c.contract_value) as total_contract_value,
          COUNT(DISTINCT c.supplier) as supplier_count
        FROM contracts c
        LEFT JOIN (
          SELECT
            spd.contract_number,
            COALESCE(SUM(
              CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
            ) FILTER (
              WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
            ), 0)::numeric AS quantity_receive,
            COALESCE(SUM(
              CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
            ) FILTER (
              WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
            ), 0)::numeric AS quantity_delivery,
            COALESCE(SUM(
              CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)
            ) FILTER (
              WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
            ), 0)::numeric AS total_sto_quantity
          FROM sap_processed_data spd
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
          GROUP BY spd.contract_number
        ) q ON q.contract_number = c.contract_id
        WHERE c.product IS NOT NULL AND c.product != '' ${contractFilter}
        GROUP BY c.product
      ) product_data
      ORDER BY total_quantity DESC
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by product' },
    });
  }
};

// Combined: breakdown each Product by Incoterm
export const getContractQuantityByProductIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(
      `
      WITH base_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.product,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          c.supplier,
          c.quantity_ordered,
          c.unit_price,
          c.contract_value,
          NULLIF(TRIM(c.po_number), '') AS po_number
        FROM contracts c
        WHERE c.product IS NOT NULL AND TRIM(c.product) != '' ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0)::numeric AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0)::numeric AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0)::numeric AS total_sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      ),
      latest_mutu AS (
        SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      latest_susut AS (
        SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      claim_mutu_po AS (
        SELECT
          NULLIF(TRIM(po_number), '') AS po_number,
          COALESCE(SUM(COALESCE(qty_claim_kg, 0)), 0)::numeric AS qty
        FROM claim_mutu_rows
        WHERE import_id = (SELECT id FROM latest_mutu)
          AND os_days IS NOT NULL
          AND os_days >= 0
          AND NULLIF(TRIM(po_number), '') IS NOT NULL
        GROUP BY 1
      ),
      claim_susut_po AS (
        SELECT
          NULLIF(TRIM(po_number), '') AS po_number,
          COALESCE(SUM(COALESCE(qty_claim, 0)), 0)::numeric AS qty
        FROM claim_susut_rows
        WHERE import_id = (SELECT id FROM latest_susut)
          AND os_days IS NOT NULL
          AND os_days >= 0
          AND NULLIF(TRIM(po_number), '') IS NOT NULL
        GROUP BY 1
      ),
      group_pos AS (
        SELECT DISTINCT
          bc.product,
          bc.incoterm,
          bc.po_number
        FROM base_contracts bc
        WHERE bc.po_number IS NOT NULL
      ),
      claims_by_group AS (
        SELECT
          gp.product,
          gp.incoterm,
          COALESCE(SUM(COALESCE(cm.qty, 0)), 0)::numeric AS outstanding_claim_mutu_qty,
          COALESCE(SUM(COALESCE(cs.qty, 0)), 0)::numeric AS outstanding_claim_susut_qty
        FROM group_pos gp
        LEFT JOIN claim_mutu_po cm ON cm.po_number = gp.po_number
        LEFT JOIN claim_susut_po cs ON cs.po_number = gp.po_number
        GROUP BY gp.product, gp.incoterm
      ),
      agg AS (
        SELECT
          bc.product,
          bc.incoterm,
          COUNT(DISTINCT bc.contract_id) AS contract_count,
          COUNT(DISTINCT bc.supplier) AS supplier_count,
          SUM(bc.quantity_ordered) AS total_quantity,
          SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
              ELSE COALESCE(db.total_sto_quantity, 0)
            END
          ) AS completed_quantity,
          COALESCE(SUM(GREATEST(
            bc.quantity_ordered - (
              CASE
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                ELSE COALESCE(db.total_sto_quantity, 0)
              END
            ),
            0
          )), 0) AS outstanding_quantity,
          SUM(
            CASE
              WHEN COALESCE(ps.has_blank_payoff, 0) = 1
              THEN (
                GREATEST(
                  bc.quantity_ordered - (
                    CASE
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                      ELSE COALESCE(db.total_sto_quantity, 0)
                    END
                  ),
                  0
                )
              )
              ELSE 0
            END
          ) AS outstanding_payment_quantity,
          AVG(bc.unit_price) AS avg_unit_price,
          SUM(bc.contract_value) AS total_contract_value
        FROM base_contracts bc
        LEFT JOIN delivered_by_contract db ON db.contract_id = bc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = bc.contract_pk
        GROUP BY bc.product, bc.incoterm
      )
      SELECT
        a.product,
        a.incoterm,
        a.contract_count,
        a.supplier_count,
        a.total_quantity,
        a.completed_quantity,
        a.outstanding_quantity,
        a.outstanding_payment_quantity,
        a.avg_unit_price,
        a.total_contract_value,
        COALESCE(cg.outstanding_claim_mutu_qty, 0)::numeric AS outstanding_claim_mutu_qty,
        COALESCE(cg.outstanding_claim_susut_qty, 0)::numeric AS outstanding_claim_susut_qty
      FROM agg a
      LEFT JOIN claims_by_group cg ON cg.product = a.product AND cg.incoterm = a.incoterm
      ORDER BY a.product, a.total_quantity DESC NULLS LAST, a.incoterm
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by product incoterm' },
    });
  }
};

// Management: breakdown Product -> Incoterm -> Plant/Site -> Source Type -> LT/SPOT
export const getContractQuantityByProductIncotermPlantSource = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(
      `
      WITH base_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.product,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          c.unit_price,
          c.contract_value,
          COALESCE(NULLIF(TRIM(c.source_type), ''), 'Blank') AS source_type,
          COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text, 'Blank') AS lt_spot,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        LEFT JOIN LATERAL (
          SELECT DISTINCT ON (spd.contract_number)
            spd.data
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        ) l ON true
        WHERE c.product IS NOT NULL AND TRIM(c.product) != '' ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0)::numeric AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0)::numeric AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0)::numeric AS total_sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      ),
      agg AS (
        SELECT
          bc.product,
          bc.incoterm,
          bc.plant_site,
          bc.source_type,
          COALESCE(NULLIF(TRIM(bc.lt_spot), ''), 'Blank') AS lt_spot,
          COUNT(DISTINCT bc.contract_id) AS contract_count,
          COUNT(DISTINCT bc.supplier) AS supplier_count,
          SUM(bc.quantity_ordered) AS total_quantity,
          SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
              ELSE COALESCE(db.total_sto_quantity, 0)
            END
          ) AS completed_quantity,
          COALESCE(SUM(GREATEST(
            bc.quantity_ordered - (
              CASE
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                ELSE COALESCE(db.total_sto_quantity, 0)
              END
            ),
            0
          )), 0) AS outstanding_quantity,
          SUM(
            CASE
              WHEN COALESCE(ps.has_blank_payoff, 0) = 1
              THEN (
                GREATEST(
                  bc.quantity_ordered - (
                    CASE
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                      ELSE COALESCE(db.total_sto_quantity, 0)
                    END
                  ),
                  0
                )
              )
              ELSE 0
            END
          ) AS outstanding_payment_quantity,
          AVG(bc.unit_price) AS avg_unit_price,
          SUM(bc.contract_value) AS total_contract_value
        FROM base_contracts bc
        LEFT JOIN delivered_by_contract db ON db.contract_id = bc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = bc.contract_pk
        GROUP BY bc.product, bc.incoterm, bc.plant_site, bc.source_type, COALESCE(NULLIF(TRIM(bc.lt_spot), ''), 'Blank')
      )
      SELECT
        a.product,
        a.incoterm,
        a.plant_site,
        a.source_type,
        a.lt_spot,
        a.contract_count,
        a.supplier_count,
        a.total_quantity,
        a.completed_quantity,
        a.outstanding_quantity,
        a.outstanding_payment_quantity,
        a.avg_unit_price,
        a.total_contract_value
      FROM agg a
      ORDER BY a.product, a.total_quantity DESC NULLS LAST, a.incoterm, a.plant_site, a.source_type, a.lt_spot
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product incoterm plant/source error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity breakdown' },
    });
  }
};

// Get contract quantity by Incoterm (same logic pattern as product, but grouped by incoterm)
export const getContractQuantityByIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(`
      SELECT
        incoterm,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity AS outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT
          COALESCE(c.incoterm, 'Blank') AS incoterm,
          COUNT(DISTINCT c.contract_id) AS contract_count,
          SUM(c.quantity_ordered) AS total_quantity,
          -- Sum of STO quantities from SAP data for all contracts under this incoterm
          SUM(
            COALESCE((
              SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
                AND spd.sto_number IS NOT NULL
                AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
            ), 0)
          ) AS completed_quantity,
          AVG(c.unit_price) AS avg_unit_price,
          SUM(c.contract_value) AS total_contract_value,
          COUNT(DISTINCT c.supplier) AS supplier_count
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY COALESCE(c.incoterm, 'Blank')
      ) incoterm_data
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by incoterm' },
    });
  }
};

// Get contract quantity by plant (Sea/Land logic)
// Updated to use actual shipped/delivered quantities from Shipments and Trucking
export const getContractQuantityByPlant = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    const result = await query(`
      WITH filtered_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), '') AS incoterm,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_location
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0)::numeric AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0)::numeric AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0)::numeric AS total_sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      per_contract AS (
        SELECT
          fc.contract_id,
          fc.supplier,
          fc.plant_location,
          fc.quantity_ordered,
          LEAST(
            fc.quantity_ordered,
            COALESCE(
              CASE
                WHEN UPPER(TRIM(COALESCE(fc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN db.quantity_receive
                WHEN UPPER(TRIM(COALESCE(fc.incoterm, ''))) IN ('LCO', 'FOB') THEN db.quantity_delivery
                ELSE db.total_sto_quantity
              END,
              0
            )
          ) AS completed_quantity,
          fc.contract_value
        FROM filtered_contracts fc
        LEFT JOIN delivered_by_contract db ON db.contract_id = fc.contract_id
      )
      SELECT
        plant_location,
        COUNT(DISTINCT contract_id)::int AS contract_count,
        COALESCE(SUM(quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(completed_quantity), 0)::numeric AS total_quantity_delivered,
        COALESCE(SUM(GREATEST(quantity_ordered - completed_quantity, 0)), 0)::numeric AS total_quantity_shipped,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value,
        COUNT(DISTINCT supplier)::int AS supplier_count
      FROM per_contract
      GROUP BY plant_location
      ORDER BY total_quantity DESC
    `, params);

    let combined = result.rows.map((p: any) => ({
      plant_location: p.plant_location,
      contract_count: parseInt(p.contract_count, 10) || 0,
      total_quantity: parseFloat(p.total_quantity) || 0,
      total_quantity_shipped: parseFloat(p.total_quantity_shipped) || 0,
      total_quantity_delivered: parseFloat(p.total_quantity_delivered) || 0,
      avg_unit_price: (parseFloat(p.total_quantity) || 0) > 0 ? (parseFloat(p.total_contract_value) || 0) / (parseFloat(p.total_quantity) || 1) : 0,
      total_contract_value: parseFloat(p.total_contract_value) || 0,
      supplier_count: parseInt(p.supplier_count, 10) || 0,
    }));

    // Merge similar plant/site labels (>= 60% similarity)
    const merged: typeof combined = [];
    const blank = combined.filter((r) => !r.plant_location || r.plant_location === 'Blank')
      .reduce((acc, r) => ({
        plant_location: 'Blank',
        contract_count: acc.contract_count + r.contract_count,
        total_quantity: acc.total_quantity + r.total_quantity,
        total_quantity_shipped: acc.total_quantity_shipped + r.total_quantity_shipped,
        total_quantity_delivered: acc.total_quantity_delivered + r.total_quantity_delivered,
        avg_unit_price: 0,
        total_contract_value: acc.total_contract_value + r.total_contract_value,
        supplier_count: acc.supplier_count + r.supplier_count,
      }), { plant_location: 'Blank', contract_count: 0, total_quantity: 0, total_quantity_shipped: 0, total_quantity_delivered: 0, avg_unit_price: 0, total_contract_value: 0, supplier_count: 0 });
    const nonBlank = combined.filter((r) => r.plant_location && r.plant_location !== 'Blank').sort((a, b) => b.total_contract_value - a.total_contract_value);
    nonBlank.forEach((row) => {
      const idx = merged.findIndex((m) => plantSimilarity(m.plant_location, row.plant_location) >= 0.6);
      if (idx >= 0) {
        merged[idx] = {
          ...merged[idx],
          plant_location: row.plant_location.length > merged[idx].plant_location.length ? row.plant_location : merged[idx].plant_location,
          contract_count: merged[idx].contract_count + row.contract_count,
          total_quantity: merged[idx].total_quantity + row.total_quantity,
          total_quantity_shipped: merged[idx].total_quantity_shipped + row.total_quantity_shipped,
          total_quantity_delivered: merged[idx].total_quantity_delivered + row.total_quantity_delivered,
          total_contract_value: merged[idx].total_contract_value + row.total_contract_value,
          supplier_count: merged[idx].supplier_count + row.supplier_count,
        };
      } else {
        merged.push(row);
      }
    });
    if (blank.contract_count > 0 || blank.total_contract_value > 0 || blank.total_quantity > 0) merged.push(blank);
    combined = merged.map((p) => ({
      ...p,
      avg_unit_price: p.total_quantity > 0 ? p.total_contract_value / p.total_quantity : 0,
    }));

    // Sort by total_quantity descending and limit to top 10
    combined.sort((a, b) => b.total_quantity - a.total_quantity);
    const topPlants = combined.slice(0, 10);

    return res.json({
      success: true,
      data: topPlants,
    });
  } catch (error) {
    logger.error('Get contract quantity by plant error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by plant' },
    });
  }
};

// Combined: breakdown each Plant/Site by Incoterm
export const getContractQuantityByPlantIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(
      `
      WITH base_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_location,
          NULLIF(TRIM(c.po_number), '') AS po_number
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0)::numeric AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0)::numeric AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0)::numeric AS total_sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      ),
      latest_mutu AS (
        SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      latest_susut AS (
        SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
      ),
      claim_mutu_po AS (
        SELECT
          NULLIF(TRIM(po_number), '') AS po_number,
          COALESCE(SUM(COALESCE(qty_claim_kg, 0)), 0)::numeric AS qty
        FROM claim_mutu_rows
        WHERE import_id = (SELECT id FROM latest_mutu)
          AND os_days IS NOT NULL
          AND os_days >= 0
          AND NULLIF(TRIM(po_number), '') IS NOT NULL
        GROUP BY 1
      ),
      claim_susut_po AS (
        SELECT
          NULLIF(TRIM(po_number), '') AS po_number,
          COALESCE(SUM(COALESCE(qty_claim, 0)), 0)::numeric AS qty
        FROM claim_susut_rows
        WHERE import_id = (SELECT id FROM latest_susut)
          AND os_days IS NOT NULL
          AND os_days >= 0
          AND NULLIF(TRIM(po_number), '') IS NOT NULL
        GROUP BY 1
      ),
      group_pos AS (
        SELECT DISTINCT
          bc.plant_location,
          bc.incoterm,
          bc.po_number
        FROM base_contracts bc
        WHERE bc.po_number IS NOT NULL
      ),
      claims_by_group AS (
        SELECT
          gp.plant_location,
          gp.incoterm,
          COALESCE(SUM(COALESCE(cm.qty, 0)), 0)::numeric AS outstanding_claim_mutu_qty,
          COALESCE(SUM(COALESCE(cs.qty, 0)), 0)::numeric AS outstanding_claim_susut_qty
        FROM group_pos gp
        LEFT JOIN claim_mutu_po cm ON cm.po_number = gp.po_number
        LEFT JOIN claim_susut_po cs ON cs.po_number = gp.po_number
        GROUP BY gp.plant_location, gp.incoterm
      ),
      agg AS (
        SELECT
          bc.plant_location,
          bc.incoterm,
          COUNT(DISTINCT bc.contract_id) AS contract_count,
          COUNT(DISTINCT bc.supplier) AS supplier_count,
          SUM(bc.quantity_ordered) AS total_quantity,
          SUM(
            CASE
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
              WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
              ELSE COALESCE(db.total_sto_quantity, 0)
            END
          ) AS completed_quantity,
          COALESCE(SUM(GREATEST(
            bc.quantity_ordered - (
              CASE
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                ELSE COALESCE(db.total_sto_quantity, 0)
              END
            ),
            0
          )), 0) AS outstanding_quantity,
          SUM(
            CASE
              WHEN COALESCE(ps.has_blank_payoff, 0) = 1
              THEN (
                GREATEST(
                  bc.quantity_ordered - (
                    CASE
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
                      WHEN UPPER(TRIM(COALESCE(bc.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
                      ELSE COALESCE(db.total_sto_quantity, 0)
                    END
                  ),
                  0
                )
              )
              ELSE 0
            END
          ) AS outstanding_payment_quantity
        FROM base_contracts bc
        LEFT JOIN delivered_by_contract db ON db.contract_id = bc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = bc.contract_pk
        GROUP BY bc.plant_location, bc.incoterm
      )
      SELECT
        a.plant_location,
        a.incoterm,
        a.contract_count,
        a.supplier_count,
        a.total_quantity,
        a.completed_quantity,
        a.outstanding_quantity,
        a.outstanding_payment_quantity,
        COALESCE(cg.outstanding_claim_mutu_qty, 0)::numeric AS outstanding_claim_mutu_qty,
        COALESCE(cg.outstanding_claim_susut_qty, 0)::numeric AS outstanding_claim_susut_qty
      FROM agg a
      LEFT JOIN claims_by_group cg ON cg.plant_location = a.plant_location AND cg.incoterm = a.incoterm
      ORDER BY a.plant_location, a.total_quantity DESC NULLS LAST, a.incoterm
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by plant incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by plant incoterm' },
    });
  }
};

// Get detailed contract information for a specific plant
export const getPlantDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { plant } = req.query;

    if (!plant) {
      return res.status(400).json({
        success: false,
        error: { message: 'Plant location is required' },
      });
    }

    let shipmentsResult;
    let truckingResult;

    if (plant === 'Blank') {
      // For blank plant locations, get records where port_of_discharge/location is NULL or empty
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE (s.port_of_discharge IS NULL OR s.port_of_discharge = '')
        ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
        ORDER BY c.contract_id
      `);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        INNER JOIN contracts c ON t.contract_id = c.id
        WHERE (t.location IS NULL OR t.location = '')
        ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
        ORDER BY c.contract_id
      `);
    } else {
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE s.port_of_discharge = $1
        ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
        ORDER BY c.contract_id
      `, [plant]);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        INNER JOIN contracts c ON t.contract_id = c.id
        WHERE t.location = $1
        ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
        ORDER BY c.contract_id
      `, [plant]);
    }

    const resultRows = [...shipmentsResult.rows, ...truckingResult.rows];

    return res.json({
      success: true,
      data: resultRows,
    });
  } catch (error) {
    logger.error('Get plant details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant details' },
    });
  }
};

// Get detailed contract information for a specific product
export const getProductDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { product } = req.query;

    if (!product) {
      return res.status(400).json({
        success: false,
        error: { message: 'Product name is required' },
      });
    }

    // Get contract details for the product including completed and outstanding quantities
    const result = await query(`
      SELECT 
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered as total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_shipped,
        c.status
      FROM contracts c
      WHERE c.product = $1
      ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ORDER BY c.contract_id
    `, [product]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get product details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product details' },
    });
  }
};

// Get detailed contract information for a specific incoterm
export const getIncotermDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { incoterm } = req.query;

    if (!incoterm) {
      return res.status(400).json({
        success: false,
        error: { message: 'Incoterm is required' },
      });
    }

    const result = await query(
      `
      SELECT
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered AS total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_shipped,
        c.status
      FROM contracts c
      WHERE COALESCE(c.incoterm, 'Blank') = $1
      ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ORDER BY c.contract_id
      `,
      [incoterm],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get incoterm details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch incoterm details' },
    });
  }
};

// Get filter options for plants
export const getFilterPlants = async (_req: AuthRequest, res: Response) => {
  try {
    // Get unique plants from both shipments and trucking operations
    const result = await query(`
      SELECT DISTINCT plant_location 
      FROM (
        SELECT 
          CASE 
            WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
            ELSE s.port_of_discharge
          END as plant_location
        FROM shipments s
        INNER JOIN contracts c ON c.id = s.contract_id
        WHERE 1=1 ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
        UNION
        SELECT 
          CASE 
            WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
            ELSE t.location
          END as plant_location
        FROM trucking_operations t
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE 1=1 ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ) plants
      WHERE plant_location IS NOT NULL
      ORDER BY plant_location
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.plant_location),
    });
  } catch (error) {
    logger.error('Get filter plants error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant filter options' },
    });
  }
};

// Get filter options for suppliers
export const getFilterSuppliers = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT supplier
      FROM contracts c
      WHERE supplier IS NOT NULL AND supplier != ''
      ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ORDER BY supplier
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.supplier),
    });
  } catch (error) {
    logger.error('Get filter suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch supplier filter options' },
    });
  }
};

// Get filter options for products
export const getFilterProducts = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT product
      FROM contracts c
      WHERE product IS NOT NULL AND product != ''
      ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ORDER BY product
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.product),
    });
  } catch (error) {
    logger.error('Get filter products error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product filter options' },
    });
  }
};

// Get filter options for group names
export const getFilterGroups = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT group_name
      FROM contracts c
      WHERE group_name IS NOT NULL AND group_name != ''
      ${DASHBOARD_EXCLUDE_B2B_CHILD_CONTRACTS_SQL}
      ORDER BY group_name
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.group_name),
    });
  } catch (error) {
    logger.error('Get filter groups error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch group filter options' },
    });
  }
};

// Return contracts list respecting dashboard filters
export const getFilteredContracts = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    const {
      contractStatus,
      shipmentStatus,
      hasShipment,
      truckingStatus,
      hasTrucking,
      paymentStatus,
      hasPayment,
      delayed,
      delivered,
      outstanding,
      outstandingLogistics,
      outstandingPayment,
      plantSite,
      sourceType,
      ltSpot,
      limit,
      offset,
    } = req.query as any;

    const extraParams = [...params];
    let whereExtra = '';

    // Contract status filter (aligned with dashboard stats logic)
    if (contractStatus) {
      const v = String(contractStatus).trim().toUpperCase();
      if (v === 'OPEN' || v === 'ACTIVE') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND (l.data->'contract'->>'status' = 'Open' OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('OPEN','ACTIVE'))
        )`;
      } else if (v === 'CLOSE' || v === 'CLOSED' || v === 'COMPLETED') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND (l.data->'contract'->>'status' = 'Close' OR UPPER(l.data->'contract'->>'status') IN ('CLOSE','CLOSED','COMPLETED')))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CLOSE','CLOSED','COMPLETED'))
        )`;
      } else if (v === 'CANCELLED' || v === 'CANCELED') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND UPPER(l.data->'contract'->>'status') IN ('CANCELLED','CANCELED','CANCEL'))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CANCELLED','CANCELED'))
        )`;
      }
    }

    // Shipment status / delayed filter (contract must have at least one matching shipment)
    if (hasShipment && String(hasShipment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id
      )`;
    }
    if (shipmentStatus) {
      extraParams.push(String(shipmentStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id AND s.status = $${extraParams.length}
      )`;
    }
    if (delayed && String(delayed).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id AND s.is_delayed = true
      )`;
    }

    // Trucking status filter (contract must have at least one matching trucking operation)
    if (hasTrucking && String(hasTrucking).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM trucking_operations t
        WHERE t.contract_id = c.id
      )`;
    }
    if (truckingStatus) {
      extraParams.push(String(truckingStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM trucking_operations t
        WHERE t.contract_id = c.id AND t.status = $${extraParams.length}
      )`;
    }

    // Payment status filter (contract must have at least one matching payment)
    if (hasPayment && String(hasPayment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id
      )`;
    }
    if (paymentStatus) {
      extraParams.push(String(paymentStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id AND UPPER(COALESCE(p.payment_status, '')) = $${extraParams.length}
      )`;
    }

    // Delivered / outstanding quantity filters (based on Incoterm rule: Receive vs Delivery; fallback STO qty)
    // delivered=true  -> delivered_quantity > 0
    // outstanding=true -> (quantity_ordered - delivered_quantity) > 0
    const deliveredBasisExpr = `
      COALESCE(
        CASE
          WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN q.quantity_receive
          WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN q.quantity_delivery
          ELSE q.sto_quantity
        END,
        0
      )
    `;
    if (delivered && String(delivered).toLowerCase() === 'true') {
      whereExtra += ` AND ${deliveredBasisExpr} > 0`;
    }
    if (outstanding && String(outstanding).toLowerCase() === 'true') {
      whereExtra += ` AND (COALESCE(c.quantity_ordered, 0) - ${deliveredBasisExpr}) > 0`;
    }

    // Open contract sub-breakdown filters used by Dashboard card
    if (outstandingLogistics && String(outstandingLogistics).toLowerCase() === 'true') {
      whereExtra += ` AND (
        EXISTS (
          SELECT 1 FROM shipments s
          WHERE s.contract_id = c.id
            AND UPPER(COALESCE(s.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
        )
        OR EXISTS (
          SELECT 1 FROM trucking_operations t
          WHERE t.contract_id = c.id
            AND UPPER(COALESCE(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
        )
      )`;
    }
    if (outstandingPayment && String(outstandingPayment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id
          AND (p.payoff_date IS NULL OR TRIM(p.payoff_date::text) = '')
      )`;
    }

    // Management dashboard breakdown filters (product/incoterm already supported via buildFilterConditions)
    if (plantSite) {
      extraParams.push(String(plantSite));
      whereExtra += ` AND UPPER(COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank')) = UPPER($${extraParams.length})`;
    }
    if (sourceType) {
      extraParams.push(String(sourceType));
      whereExtra += ` AND UPPER(COALESCE(NULLIF(TRIM(c.source_type), ''), 'Blank')) = UPPER($${extraParams.length})`;
    }
    if (ltSpot) {
      extraParams.push(String(ltSpot));
      whereExtra += ` AND UPPER(COALESCE(NULLIF(TRIM(COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text)), ''), 'Blank')) = UPPER($${extraParams.length})`;
    }

    // Allow paging for dashboard drilldowns (default limit 100, max 500)
    const limitNumRaw = parseInt(String(limit ?? ''), 10);
    const limitNum = Number.isFinite(limitNumRaw)
      ? Math.min(Math.max(limitNumRaw, 1), 500)
      : 100;

    const offsetNumRaw = parseInt(String(offset ?? ''), 10);
    const offsetNum = Number.isFinite(offsetNumRaw)
      ? Math.max(offsetNumRaw, 0)
      : 0;

    extraParams.push(limitNum);
    extraParams.push(offsetNum);

    const result = await query(`
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data
        FROM sap_processed_data spd
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      qty AS (
        SELECT
          spd.contract_number,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
          ), 0) AS quantity_receive,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
          ), 0) AS quantity_delivery,
          COALESCE(SUM(
            CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)
          ) FILTER (
            WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
          ), 0) AS sto_quantity
        FROM sap_processed_data spd
        GROUP BY spd.contract_number
      ),
      base AS (
        SELECT
          c.id,
          c.contract_id,
          c.buyer,
          c.supplier,
          c.group_name,
          c.product,
          c.quantity_ordered,
          c.unit,
          c.incoterm,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site,
          c.source_type,
          COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text) AS lt_spot,
          c.loading_site,
          c.unloading_site,
          c.contract_date,
          c.delivery_start_date,
          c.delivery_end_date,
          c.cargo_readiness_date,
          COALESCE(
            NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''),
            l.data->'contract'->>'transport_mode',
            l.data->'contract'->>'sea_land',
            l.data->'raw'->>'Sea / Land',
            l.data->'raw'->>'Sea_Land',
            ''
          ) AS transport_mode,
          l.data AS latest_spd_data,
          COALESCE(l.data->'raw'->>'Contract Ext No', l.data->>'Contract Ext No') AS contract_ext_no,
          c.contract_value,
          pinfo.payment_due_date,
          pinfo.payoff_date,
          pinfo.last_trucking_completion_date,
          pinfo.last_ata_vessel_complete_discharge,
          lr.trucking_last_receive_date,
          pinfo.dp_date_deviation_days,
          pinfo.payoff_date_deviation_days,
          CASE
            WHEN UPPER(COALESCE(NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''), l.data->'contract'->>'transport_mode', l.data->'contract'->>'sea_land', l.data->'raw'->>'Sea / Land', l.data->'raw'->>'Sea_Land', '')) LIKE 'LAND%'
              THEN (c.delivery_end_date::date - lr.trucking_last_receive_date::date)
            WHEN UPPER(COALESCE(NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''), l.data->'contract'->>'transport_mode', l.data->'contract'->>'sea_land', l.data->'raw'->>'Sea / Land', l.data->'raw'->>'Sea_Land', '')) LIKE 'SEA%'
              THEN (c.delivery_end_date::date - pinfo.last_ata_vessel_complete_discharge::date)
            ELSE NULL
          END AS total_delay,
          (c.delivery_end_date::date - c.cargo_readiness_date::date) AS cargo_readiness_issue,
          CASE
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(q.quantity_receive, 0)
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(q.quantity_delivery, 0)
            ELSE COALESCE(q.sto_quantity, 0)
          END AS delivered_quantity
          (c.delivery_end_date::date - CURRENT_DATE) AS aging_os,
          CASE
            WHEN UPPER(COALESCE(NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''), l.data->'contract'->>'transport_mode', l.data->'contract'->>'sea_land', l.data->'raw'->>'Sea / Land', l.data->'raw'->>'Sea_Land', '')) LIKE 'LAND%'
              THEN (c.cargo_readiness_date::date - lr.trucking_last_receive_date::date)
            WHEN UPPER(COALESCE(NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''), l.data->'contract'->>'transport_mode', l.data->'contract'->>'sea_land', l.data->'raw'->>'Sea / Land', l.data->'raw'->>'Sea_Land', '')) LIKE 'SEA%'
              THEN (c.cargo_readiness_date::date - pinfo.last_ata_vessel_complete_discharge::date)
            ELSE NULL
          END AS delivery_issue,
          c.currency,
          -- Status displayed should match dashboard logic and Contracts page conventions
          CASE
            WHEN l.data IS NOT NULL AND (
              l.data->'contract'->>'status' = 'Open'
              OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'
            ) THEN 'Open'
            WHEN l.data IS NOT NULL AND (
              l.data->'contract'->>'status' = 'Close'
              OR UPPER(l.data->'contract'->>'status') IN ('CLOSE','CLOSED','COMPLETED')
            ) THEN 'Close'
            WHEN l.data IS NOT NULL AND (
              UPPER(l.data->'contract'->>'status') IN ('CANCELLED','CANCELED','CANCEL')
            ) THEN 'Cancelled'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('OPEN','ACTIVE') THEN 'Open'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CLOSE','CLOSED','COMPLETED') THEN 'Close'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CANCELLED','CANCELED','CANCEL') THEN 'Cancelled'
            ELSE COALESCE(c.status, '')
          END AS status,
          CASE
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(q.quantity_receive, 0)
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(q.quantity_delivery, 0)
            ELSE COALESCE(q.sto_quantity, 0)
          END AS delivered_quantity,
          (COALESCE(c.quantity_ordered, 0) - COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN q.quantity_receive
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN q.quantity_delivery
              ELSE q.sto_quantity
            END,
            0
          )) AS outstanding_quantity
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        LEFT JOIN qty q ON q.contract_number = c.contract_id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            l.data->'contract'->>'transport_mode',
            l.data->'contract'->>'sea_land',
            l.data->'raw'->>'Sea / Land',
            l.data->'raw'->>'Sea_Land',
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
              WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
              WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
              WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YYYY')
              ELSE NULL
            END AS trucking_last_receive_date
          FROM (
            SELECT COALESCE(l.data->'raw'->>'Trucking Last Receive Date', l.data->>'Trucking Last Receive Date') AS last_receive_raw
          ) x
        ) lr ON true
        LEFT JOIN LATERAL (
          SELECT
            MIN(p.payment_due_date) FILTER (WHERE p.payoff_date IS NULL) AS payment_due_date,
            MAX(p.payoff_date) AS payoff_date,
            (SELECT (p2.dp_date::date - p2.payment_due_date::date)
             FROM payments p2
             WHERE p2.contract_id = c.id AND p2.dp_date IS NOT NULL AND p2.payment_due_date IS NOT NULL
             ORDER BY p2.created_at DESC NULLS LAST
             LIMIT 1) AS dp_date_deviation_days,
            (SELECT (p3.payoff_date::date - p3.payment_due_date::date)
             FROM payments p3
             WHERE p3.contract_id = c.id AND p3.payoff_date IS NOT NULL AND p3.payment_due_date IS NOT NULL
             ORDER BY p3.created_at DESC NULLS LAST
             LIMIT 1) AS payoff_date_deviation_days,
            (SELECT MAX(t.trucking_completion_date) FROM trucking_operations t WHERE t.contract_id = c.id) AS last_trucking_completion_date,
            (SELECT MAX(s.ata_discharge_complete::date) FROM shipments s WHERE s.contract_id = c.id AND s.ata_discharge_complete IS NOT NULL) AS last_ata_vessel_complete_discharge
          FROM payments p
          WHERE p.contract_id = c.id
        ) pinfo ON true
        WHERE 1=1 ${contractFilter} ${whereExtra}
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS total_count,
        jsonb_agg(to_jsonb(r) ORDER BY r.contract_date DESC, r.contract_id ASC) AS rows
      FROM (
        SELECT *
        FROM base
        ORDER BY contract_date DESC, contract_id ASC
        LIMIT $${extraParams.length - 1}
        OFFSET $${extraParams.length}
      ) r
    `, extraParams);

    const row0 = result.rows?.[0] as any;
    const totalCount = Number(row0?.total_count) || 0;
    const rows = Array.isArray(row0?.rows) ? row0.rows : [];

    const asDate = (d: unknown): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return d;
      if (typeof d === 'string') {
        const t = Date.parse(d);
        if (Number.isNaN(t)) return null;
        return new Date(t);
      }
      return null;
    };
    const parseFlexibleDate = (v: unknown): Date | null => {
      if (v == null) return null;
      if (v instanceof Date) return v;
      const s = String(v).trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
      const mmddyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (mmddyy) {
        const mm = Number(mmddyy[1]);
        const dd = Number(mmddyy[2]);
        const yy = Number(mmddyy[3]);
        const fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
        return new Date(Date.UTC(fullYear, mm - 1, dd));
      }
      const mmddyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mmddyyyy) {
        const mm = Number(mmddyyyy[1]);
        const dd = Number(mmddyyyy[2]);
        const yyyy = Number(mmddyyyy[3]);
        return new Date(Date.UTC(yyyy, mm - 1, dd));
      }
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return new Date(t);
      return null;
    };
    const diffInDays = (start: unknown, end: unknown): number | null => {
      const s = asDate(start);
      const e = asDate(end);
      if (!s || !e) return null;
      const msPerDay = 24 * 60 * 60 * 1000;
      const sMid = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const eMid = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      return Math.round((eMid.getTime() - sMid.getTime()) / msPerDay);
    };

    // Compute log_cycle_days + cash_cycle_days for drilldown weighted averages
    const today = new Date();
    const todayMidIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    for (const r of rows) {
      const spd = (r as any).latest_spd_data || {};
      const spdPayment = (spd && typeof spd === 'object') ? (spd as any).payment || {} : {};
      const spdRaw = (spd && typeof spd === 'object') ? (spd as any).raw || {} : {};
      const statusText = String(r.status || '').trim().toUpperCase();
      const transport = String(r.transport_mode || '').toUpperCase();
      const cargoReadyRaw =
        r.cargo_readiness_date ||
        spdPayment?.cargo_readiness_date ||
        spdRaw?.['Cargo Readiness Date'] ||
        spdRaw?.['Contract Readiness Date'] ||
        null;
      const cargoReady = cargoReadyRaw || r.contract_date || r.delivery_start_date || null;
      const lastTruck = r.last_trucking_completion_date;
      const lastAtaDischarge = r.last_ata_vessel_complete_discharge;
      const payoffDate =
        r.payoff_date ||
        parseFlexibleDate(spdPayment?.payoff_date) ||
        parseFlexibleDate(spdRaw?.['Payoff Date']) ||
        null;
      const dueDatePayment =
        r.payment_due_date ||
        parseFlexibleDate(spdPayment?.due_date_payment) ||
        parseFlexibleDate(spdRaw?.['Due Date Payment']) ||
        null;
      const cashStartLand = lastTruck || cargoReady || r.contract_date || r.delivery_start_date || null;
      const cashStartSea = lastAtaDischarge || cargoReady || r.contract_date || r.delivery_start_date || null;

      let logCycle: number | null = null;
      if (transport.startsWith('LAND')) {
        if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
          const d = diffInDays(cargoReady, lastTruck);
          if (d != null) logCycle = d;
        } else if (statusText === 'OPEN' || statusText === 'ACTIVE') {
          const d = diffInDays(cargoReady, todayMidIso);
          if (d != null) logCycle = d;
        }
      } else if (transport.startsWith('SEA')) {
        if (statusText === 'OPEN' || statusText === 'ACTIVE') {
          const d = diffInDays(cargoReady, todayMidIso);
          if (d != null) logCycle = d;
        } else if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
          const d = diffInDays(cargoReady, lastAtaDischarge);
          if (d != null) logCycle = d;
        }
      }
      (r as any).log_cycle_days = logCycle;

      let cashCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && payoffDate) {
        if (transport.startsWith('LAND')) {
          const d = diffInDays(cashStartLand, payoffDate);
          if (d != null) cashCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(cashStartSea, payoffDate);
          if (d != null) cashCycle = d;
        }
      } else if (dueDatePayment) {
        // Fallback for unpaid / open contracts: expected payment cycle to due date
        if (transport.startsWith('LAND')) {
          const d = diffInDays(cashStartLand, dueDatePayment);
          if (d != null) cashCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(cashStartSea, dueDatePayment);
          if (d != null) cashCycle = d;
        }
      }
      (r as any).cash_cycle_days = cashCycle;
      delete (r as any).latest_spd_data;
    }
    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit: limitNum, offset: offsetNum },
    });
  } catch (error) {
    logger.error('Get filtered contracts error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to get filtered contracts' } });
  }
};