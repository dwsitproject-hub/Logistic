import { PoolClient } from 'pg';
import logger from '../utils/logger';

export interface DistributionResult {
  contractId?: string;
  shipmentId?: string;
  qualitySurveyIds: string[];
  truckingOperationIds: string[];
  paymentId?: string;
  surveyorIds: string[];
}

export class SapDataDistributionService {
  private static toUuid(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    // UUID v4-ish validation (accept any valid UUID)
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRe.test(s) ? s : null;
  }

  private static normalizeContractStatus(raw: any): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const u = s.toUpperCase();
    if (u === 'ACTIVE' || u === 'OPEN') return 'Open';
    if (u === 'CLOSE' || u === 'CLOSED' || u === 'COMPLETED' || u === 'COMPLETE') return 'Close';
    if (u === 'CANCELLED' || u === 'CANCELED' || u === 'CANCEL') return 'Cancelled';
    return s;
  }

  /** Persist status using legacy DB values so both old and new contracts_status_check pass. */
  private static statusForDb(normalized: string | null): string {
    if (!normalized) return 'ACTIVE';
    switch (normalized) {
      case 'Open': return 'ACTIVE';
      case 'Close': return 'COMPLETED';
      case 'Cancelled': return 'CANCELLED';
      default: return normalized;
    }
  }
  
  /**
   * Resolve a contract id from available parsed data. Falls back to
   * prior processed SAP data using STO number to find the contract number.
   */
  private static async resolveContractId(
    client: PoolClient,
    parsedData: any
  ): Promise<string | undefined> {
    // Try direct upsert path keys
    const contractNumber: string | undefined = parsedData?.contract?.contract_no || undefined;
    const poNumber: string | undefined = parsedData?.contract?.po_no || undefined;
    if (contractNumber || poNumber) {
      const existing = await client.query(
        `SELECT id FROM contracts WHERE contract_id = $1 OR po_number = $2 LIMIT 1`,
        [contractNumber || null, poNumber || null]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0].id as string;
      }
    }

    // Fallback: use STO number to find prior processed data => contract_number => contract id
    const stoNumber: string | undefined = parsedData?.shipment?.sto_no || parsedData?.contract?.sto_no || undefined;
    if (stoNumber) {
      const prior = await client.query(
        `SELECT contract_number FROM sap_processed_data 
         WHERE sto_number = $1 AND contract_number IS NOT NULL 
         ORDER BY created_at DESC NULLS LAST LIMIT 1`,
        [stoNumber]
      );
      const priorContractNumber: string | undefined = prior.rows[0]?.contract_number;
      if (priorContractNumber) {
        const existingByPrior = await client.query(
          `SELECT id FROM contracts WHERE contract_id = $1 LIMIT 1`,
          [priorContractNumber]
        );
        if (existingByPrior.rows.length > 0) {
          return existingByPrior.rows[0].id as string;
        }
      }
    }

    return undefined;
  }

  /**
   * Distribute parsed SAP data to main tables
   */
  static async distributeData(
    client: PoolClient,
    parsedData: any,
    userId?: string
  ): Promise<DistributionResult> {
    const result: DistributionResult = {
      qualitySurveyIds: [],
      truckingOperationIds: [],
      surveyorIds: []
    };
    
    try {
      // Normalize: in some files STO lives under shipment (not contract). Ensure contract upsert receives it.
      if (parsedData?.contract && parsedData?.shipment) {
        if (!parsedData.contract.sto_no && parsedData.shipment.sto_no) {
          parsedData.contract.sto_no = parsedData.shipment.sto_no;
        }
        if (!parsedData.contract.sto_quantity && parsedData.shipment.sto_quantity) {
          parsedData.contract.sto_quantity = parsedData.shipment.sto_quantity;
        }
      }

      // 1. Create or update contract
      if (this.hasContractData(parsedData.contract, parsedData)) {
        try {
          logger.info('Attempting to upsert contract with data:', {
            contract_no: parsedData.contract?.contract_no,
            po_no: parsedData.contract?.po_no,
            supplier: parsedData.contract?.supplier,
            product: parsedData.contract?.product
          });
          result.contractId = await this.upsertContract(client, parsedData.contract, userId);
          logger.info('Contract upserted successfully:', result.contractId);
        } catch (contractError) {
          logger.error('Failed to upsert contract:', contractError);
          logger.error('Contract data:', JSON.stringify(parsedData.contract, null, 2));
          throw contractError;
        }
      } else {
        logger.info('No contract data found, attempting to resolve from prior processed data');
        // Fallback: try to resolve existing contract id from prior processed data
        result.contractId = await this.resolveContractId(client, parsedData);
      }
      
      // 2. Route to Shipments or Trucking based on SEA / LAND field
      // Get the sea_land value from contract data (normalized from "SEA / LAND" field)
      const seaLandValue = parsedData.contract?.sea_land || parsedData.contract?.transport_mode || null;
      const isLand = seaLandValue && seaLandValue.toString().toUpperCase().trim() === 'LAND';
      const isSea = seaLandValue && seaLandValue.toString().toUpperCase().trim() === 'SEA';
      const hasShipment = this.hasShipmentData(parsedData.shipment);
      const hasVesselLike =
        !!(
          parsedData.shipment?.vessel_name ||
          parsedData.shipment?.vessel_code ||
          parsedData.shipment?.voyage_no ||
          parsedData.shipment?.vessel_owner ||
          parsedData.shipment?.vessel_loading_port_1 ||
          parsedData.shipment?.vessel_discharge_port
        );
      const assumeSea = !isLand && !isSea && hasShipment && hasVesselLike;
      
      logger.info('Routing decision based on SEA / LAND:', {
        sea_land: seaLandValue,
        isLand,
        isSea: isSea || assumeSea,
        hasShipmentData: hasShipment,
        assumedSea: assumeSea
      });
      
      // 2a. Create or update shipment (only if SEA / LAND = "SEA")
      if ((isSea || assumeSea) && hasShipment) {
        try {
          // Extract vessel data from shipment object (where it's actually stored)
          const vesselData = {
            vessel_name: parsedData.shipment?.vessel_name,
            vessel_code: parsedData.shipment?.vessel_code,
            voyage_no: parsedData.shipment?.voyage_no,
            vessel_owner: parsedData.shipment?.vessel_owner,
            vessel_draft: parsedData.shipment?.vessel_draft,
            vessel_loa: parsedData.shipment?.vessel_loa,
            vessel_capacity: parsedData.shipment?.vessel_capacity,
            vessel_hull_type: parsedData.shipment?.vessel_hull_type,
            vessel_registration_year: parsedData.shipment?.vessel_registration_year || parsedData.vessel?.registration_year,
            charter_type: parsedData.shipment?.charter_type || parsedData.vessel?.charter_type
          };
          
          logger.info('Attempting to upsert shipment with data (SEA):', {
            sto_no: parsedData.shipment?.sto_no,
            vessel_name: vesselData.vessel_name,
            contractId: result.contractId
          });
          result.shipmentId = await this.upsertShipment(
            client,
            parsedData.shipment,
            result.contractId, // ensure we link shipment to whatever contract id we resolved
            vesselData,
            userId
          );
          logger.info('Shipment upserted successfully:', result.shipmentId);
          
          // Create or update vessel loading ports
          await this.upsertVesselLoadingPorts(client, result.shipmentId, parsedData);
          logger.info('Vessel loading ports processed for shipment:', result.shipmentId);
        } catch (shipmentError) {
          logger.error('Failed to upsert shipment:', shipmentError);
          logger.error('Shipment data:', JSON.stringify(parsedData.shipment, null, 2));
          throw shipmentError;
        }
      } else if (isLand && this.hasShipmentData(parsedData.shipment)) {
        // 2b. Create trucking operation (if SEA / LAND = "LAND")
        // Convert shipment data to trucking operation format
        try {
          logger.info('Creating trucking operation from shipment data (LAND):', {
            sto_no: parsedData.shipment?.sto_no,
            contractId: result.contractId
          });
          
          // Convert shipment data to trucking operation format
          const truckingDataFromShipment = {
            sequence: 1,
            data: {
              cargo_readiness_at_starting_location: parsedData.shipment?.eta_vessel_arrival_loading_port_1 || null,
              truck_loading_at_starting_location: parsedData.shipment?.vessel_loading_port_1 || null,
              truck_unloading_at_starting_location: parsedData.shipment?.vessel_discharge_port || null,
              trucking_owner_at_starting_location: parsedData.shipment?.vessel_owner || null,
              trucking_oa_budget_at_starting_location: null,
              trucking_oa_actual_at_starting_location: null,
              quantity_sent_via_trucking_based_on_surat_jalan: parsedData.shipment?.quantity_at_loading_port_1_based_on_bast || null,
              quantity_delivered_via_trucking: parsedData.shipment?.quantity_delivered || null,
              trucking_gain_loss_at_starting_location: null,
              trucking_starting_date_at_starting_location: parsedData.shipment?.eta_vessel_arrival_loading_port_1 || null,
              trucking_completion_date_at_starting_location: parsedData.shipment?.ata_vessel_sailed_at_loading_port_1 || null
            }
          };
          
          const truckingId = await this.createTruckingOperation(
            client,
            undefined, // No shipment_id for LAND operations
            result.contractId,
            truckingDataFromShipment
          );
          if (truckingId) result.truckingOperationIds.push(truckingId);
          logger.info('Trucking operation created successfully from shipment data:', truckingId);
        } catch (truckingError) {
          logger.error('Failed to create trucking operation from shipment data:', truckingError);
          logger.error('Shipment data:', JSON.stringify(parsedData.shipment, null, 2));
          throw truckingError;
        }
      } else {
        logger.info('No shipment/trucking data found to upsert or SEA/LAND value not set');
      }
      
      // 3. Create quality surveys (multiple) - only for SEA shipments
      if (isSea && parsedData.quality && parsedData.quality.length > 0) {
        for (const qualityData of parsedData.quality) {
          const surveyId = await this.createQualitySurvey(
            client,
            result.shipmentId,
            qualityData
          );
          if (surveyId) result.qualitySurveyIds.push(surveyId);
        }
      }
      
      // 4. Create trucking operations (multiple) - only if explicitly in trucking array and not LAND routing
      // Note: For LAND, we already created trucking operations above from shipment data
      if (!isLand && parsedData.trucking && parsedData.trucking.length > 0) {
        for (const truckingData of parsedData.trucking) {
          const truckingId = await this.createTruckingOperation(
            client,
            result.shipmentId,
            result.contractId,
            truckingData
          );
          if (truckingId) result.truckingOperationIds.push(truckingId);
        }
      }
      
      // 5. Create or update payment
      if (this.hasPaymentData(parsedData.payment)) {
        result.paymentId = await this.upsertPayment(
          client,
          parsedData.payment,
          result.contractId
        );
      }
      
      return result;
      
    } catch (error) {
      logger.error('Data distribution failed', error);
      throw error;
    }
  }
  
  /**
   * Create or update contract
   */
  private static async upsertContract(
    client: PoolClient,
    contractData: any,
    userId?: string
  ): Promise<string> {
    const contractNumber = contractData.contract_no != null ? String(contractData.contract_no).trim() || null : null;
    const poNumber = contractData.po_no != null ? String(contractData.po_no).trim() || null : null;
    const effectiveContractId = contractNumber || (poNumber ? `PO-${poNumber}` : null);

    if (!effectiveContractId) {
      throw new Error('Contract number or PO number is required');
    }

    const quantity = this.parseNumber(contractData.contract_quantity);
    const unitPrice = this.parseNumber(contractData.unit_price);
    const contractValue = (quantity && unitPrice) ? quantity * unitPrice : null;
    const statusNorm = this.normalizeContractStatus(contractData.status) || 'Open';
    const statusForDb = this.statusForDb(statusNorm);

    // Upsert: insert or update on conflict (contract_id unique) so re-upload of same contract updates instead of failing
    const result = await client.query(
      `INSERT INTO contracts (
        contract_id, group_name, supplier, buyer, contract_date, product, po_number,
        incoterm, transport_mode, quantity_ordered, unit, unit_price, contract_value,
        delivery_start_date, delivery_end_date, source_type, contract_type,
        status, sto_number, sto_quantity, logistics_classification, po_classification,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10::numeric, 'MT', $11::numeric, $12::numeric,
        $13::date, $14::date, $15, $16, $17, $18, $19::numeric, $20, $21, $22
      )
      ON CONFLICT (contract_id) DO UPDATE SET
        group_name = COALESCE(EXCLUDED.group_name, contracts.group_name),
        supplier = COALESCE(EXCLUDED.supplier, contracts.supplier),
        buyer = COALESCE(EXCLUDED.buyer, contracts.buyer),
        contract_date = COALESCE(EXCLUDED.contract_date, contracts.contract_date),
        product = COALESCE(EXCLUDED.product, contracts.product),
        po_number = COALESCE(EXCLUDED.po_number, contracts.po_number),
        incoterm = COALESCE(EXCLUDED.incoterm, contracts.incoterm),
        transport_mode = COALESCE(EXCLUDED.transport_mode, contracts.transport_mode),
        quantity_ordered = COALESCE(EXCLUDED.quantity_ordered, contracts.quantity_ordered),
        unit_price = COALESCE(EXCLUDED.unit_price, contracts.unit_price),
        contract_value = COALESCE(EXCLUDED.contract_value, contracts.contract_value),
        delivery_start_date = COALESCE(EXCLUDED.delivery_start_date, contracts.delivery_start_date),
        delivery_end_date = COALESCE(EXCLUDED.delivery_end_date, contracts.delivery_end_date),
        source_type = COALESCE(EXCLUDED.source_type, contracts.source_type),
        contract_type = COALESCE(EXCLUDED.contract_type, contracts.contract_type),
        status = COALESCE(EXCLUDED.status, contracts.status),
        sto_number = COALESCE(EXCLUDED.sto_number, contracts.sto_number),
        sto_quantity = COALESCE(EXCLUDED.sto_quantity, contracts.sto_quantity),
        logistics_classification = COALESCE(EXCLUDED.logistics_classification, contracts.logistics_classification),
        po_classification = COALESCE(EXCLUDED.po_classification, contracts.po_classification),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
      [
        effectiveContractId,
        contractData.group,
        contractData.supplier,
        contractData.buyer || contractData.group || 'Unknown',
        this.parseDate(contractData.contract_date),
        contractData.product,
        poNumber,
        contractData.incoterm,
        contractData.sea_land || contractData.transport_mode,
        quantity,
        unitPrice,
        contractValue,
        this.parseDate(contractData.due_date_delivery_start),
        this.parseDate(contractData.due_date_delivery_end),
        contractData.source,
        contractData.contract_type || contractData.ltc_spot,
        statusForDb,
        contractData.sto_no,
        this.parseNumber(contractData.sto_quantity),
        contractData.logistics_area_classification,
        contractData.sto_classification || contractData.po_classification,
        userId
      ]
    );
    return result.rows[0].id;
  }
  
  /**
   * Create or update shipment
   */
  private static async upsertShipment(
    client: PoolClient,
    shipmentData: any,
    contractId: string | undefined,
    vesselData: any,
    _userId?: string
  ): Promise<string> {
    const contractUuid = this.toUuid(contractId);
    const shipmentIdFromSap = shipmentData.shipment_id || shipmentData.sto_no;

    const voyageNo = vesselData.voyage_no || shipmentData.voyage_no;
    const vesselCode = vesselData.vessel_code || shipmentData.vessel_code;
    const vesselName = vesselData.vessel_name || shipmentData.vessel_name;
    const vesselOwner = vesselData.vessel_owner || shipmentData.vessel_owner;

    const vesselDraft = this.parseNumber(shipmentData.vessel_draft ?? vesselData.vessel_draft);
    const vesselLoa = this.parseNumber(shipmentData.vessel_loa ?? vesselData.vessel_loa);
    const vesselCapacity = this.parseNumber(shipmentData.vessel_capacity ?? vesselData.vessel_capacity);
    const vesselHullType = vesselData.vessel_hull_type || shipmentData.vessel_hull_type;
    const vesselRegistrationYear = this.parseInteger(shipmentData.vessel_registration_year ?? vesselData.vessel_registration_year);

    const charterType = vesselData.charter_type || shipmentData.charter_type;
    const loadingMethod = shipmentData.loading_method || null;
    const dischargeMethod = shipmentData.discharge_method || null;

    // Prioritize vessel_loading_port_1 from SAP data, ensuring we don't use invalid values like '0.00'
    let portOfLoading = shipmentData.vessel_loading_port_1 || shipmentData.port_of_loading || shipmentData.loading_port || shipmentData.loading_port_1 || null;
    if (portOfLoading && (portOfLoading === '0.00' || portOfLoading.trim() === '')) {
      portOfLoading = null;
    }
    
    let portOfDischarge = shipmentData.vessel_discharge_port || shipmentData.port_of_discharge || shipmentData.discharge_port || null;
    if (portOfDischarge && (portOfDischarge === '0.00' || portOfDischarge.trim() === '')) {
      portOfDischarge = null;
    }

    const etaArrival = this.parseDate(shipmentData.eta_vessel_arrival_loading_port_1 || shipmentData.eta_arrival_loading_port_1);
    const ataArrival = this.parseDate(shipmentData.ata_vessel_arrival_at_loading_port_1);
    const etaSailed = this.parseDate(shipmentData.eta_vessel_sailed_at_loading_port_1);
    const ataSailed = this.parseDate(shipmentData.ata_vessel_sailed_at_loading_port_1 ?? shipmentData.ata_vessel_sailed_from_loading_port);

    const shipmentDate = this.parseDate(shipmentData.shipment_date);
    const arrivalDate = this.parseDate(shipmentData.arrival_date);

    const quantityShipped = this.parseNumber(shipmentData.quantity_at_loading_port_1_based_on_bast ?? shipmentData.quantity_shipped);
    // SAP MASTER v2 columns normalize to `quantity_delivery` and `quantity_receive`.
    // Map those to shipment fields used throughout the app.
    const quantityDelivery = this.parseNumber(shipmentData.quantity_delivery ?? shipmentData.quantity_delivered);
    const quantityReceive = this.parseNumber(shipmentData.quantity_receive ?? shipmentData.actual_vessel_qty_receive ?? shipmentData.quantity_delivered);
    const actualVesselQtyReceive = quantityReceive;
    const blQuantity = this.parseNumber(shipmentData.bl_quantity);
    const quantityDelivered = quantityDelivery ?? actualVesselQtyReceive ?? this.parseNumber(shipmentData.quantity_delivered);
    let difference = this.parseNumber(shipmentData.difference_final_qty_vs_bl_qty);
    if (difference === null && actualVesselQtyReceive !== null && blQuantity !== null) {
      difference = actualVesselQtyReceive - blQuantity;
    }

    const estimatedKm = this.parseNumber(shipmentData.estimated_km);
    const estimatedNm = this.parseNumber(shipmentData.estimated_nautical_miles ?? shipmentData.estimated_nm);
    const vesselOaBudget = this.parseNumber(shipmentData.vessel_oa_budget);
    const vesselOaActual = this.parseNumber(shipmentData.vessel_oa_actual);
    const averageVesselSpeed = this.parseNumber(shipmentData.average_vessel_speed);

    const etaLoadingStart = this.parseDate(shipmentData.eta_loading_start_at_loading_port_1);
    const ataLoadingStart = this.parseDate(shipmentData.ata_loading_start_at_loading_port_1 ?? shipmentData.ata_vessel_start_loading);
    const etaLoadingComplete = this.parseDate(shipmentData.eta_loading_completed_at_loading_port_1);
    const ataLoadingComplete = this.parseDate(shipmentData.ata_loading_completed_at_loading_port_1 ?? shipmentData.ata_vessel_completed_loading);

    const etaDischargeArrival = this.parseDate(shipmentData.eta_arrival_at_discharge_port);
    const ataDischargeArrival = this.parseDate(shipmentData.ata_vessel_arrival_at_discharge_port);
    const etaDischargeStart = this.parseDate(shipmentData.eta_discharging_start_at_discharge_port);
    const ataDischargeStart = this.parseDate(shipmentData.ata_discharging_start_at_discharge_port ?? shipmentData.ata_vessel_start_discharging);
    const etaDischargeComplete = this.parseDate(shipmentData.eta_discharging_completed_at_discharge_port);
    const ataDischargeComplete = this.parseDate(shipmentData.ata_discharging_completed_at_discharge_port ?? shipmentData.ata_vessel_completed_discharge);

    const loadingRate = this.parseNumber(shipmentData.loading_rate_at_loading_port_1);
    const dischargeRate = this.parseNumber(shipmentData.discharge_rate_at_discharging_port);
    const loadingDurationDays = this.parseInteger(shipmentData.loading_duration_days);
    const dischargeDurationDays = this.parseInteger(shipmentData.discharge_duration_days);
    const totalLeadTimeDays = this.parseInteger(shipmentData.total_lead_time_days);

    const shipmentStatus = shipmentData.status ? String(shipmentData.status).trim().toUpperCase() : null;
    const statusForInsert = shipmentStatus || 'PLANNED';

    // Strategy:
    // 1) Prefer direct match by shipment_id from SAP.
    // 2) Otherwise, when contractId + vesselName are present, look for a shipment for this contract
    //    whose vessel_name is at least 80% similar. If found, update that shipment instead of inserting.

    let targetShipmentId: string | null = null;

    if (shipmentIdFromSap) {
      const existingByShipment = await client.query(
        `SELECT id FROM shipments WHERE shipment_id = $1 LIMIT 1`,
        [shipmentIdFromSap]
      );
      if (existingByShipment.rows.length > 0) {
        targetShipmentId = existingByShipment.rows[0].id;
      }
    }

    if (!targetShipmentId && contractUuid && vesselName) {
      const existingForContract = await client.query(
        `SELECT id, vessel_name FROM shipments WHERE contract_id = $1`,
        [contractUuid]
      );

      let bestId: string | null = null;
      let bestScore = 0;
      for (const row of existingForContract.rows) {
        const score = this.stringSimilarity(vesselName, row.vessel_name);
        if (score > bestScore) {
          bestScore = score;
          bestId = row.id;
        }
      }

      if (bestId && bestScore >= 0.8) {
        targetShipmentId = bestId;
      }
    }

    if (targetShipmentId) {
      const id = targetShipmentId;
      await client.query(
        `UPDATE shipments SET
          contract_id = COALESCE($1::uuid, contract_id),
          voyage_no = COALESCE($2, voyage_no),
          vessel_code = COALESCE($3, vessel_code),
          vessel_owner = COALESCE($4, vessel_owner),
          vessel_draft = COALESCE($5::numeric, vessel_draft),
          vessel_loa = COALESCE($6::numeric, vessel_loa),
          vessel_capacity = COALESCE($7::numeric, vessel_capacity),
          vessel_hull_type = COALESCE($8, vessel_hull_type),
          vessel_registration_year = COALESCE($9::int, vessel_registration_year),
          charter_type = COALESCE($10, charter_type),
          loading_method = COALESCE($11, loading_method),
          discharge_method = COALESCE($12, discharge_method),
          port_of_loading = CASE WHEN $13::text IS NOT NULL AND trim(COALESCE($13::text, '')) != '' AND trim(COALESCE($13::text, '')) != '0.00' THEN $13::text ELSE port_of_loading END,
          port_of_discharge = CASE WHEN $14::text IS NOT NULL AND trim(COALESCE($14::text, '')) != '' AND trim(COALESCE($14::text, '')) != '0.00' THEN $14::text ELSE port_of_discharge END,
          shipment_date = COALESCE($15::date, shipment_date),
          arrival_date = COALESCE($16::date, arrival_date),
          quantity_shipped = COALESCE($17::numeric, quantity_shipped),
          quantity_delivered = COALESCE($18::numeric, quantity_delivered),
          bl_quantity = COALESCE($19::numeric, bl_quantity),
          actual_vessel_qty_receive = COALESCE($20::numeric, actual_vessel_qty_receive),
          difference_final_qty_vs_bl_qty = COALESCE($21::numeric, difference_final_qty_vs_bl_qty),
          estimated_km = COALESCE($22::numeric, estimated_km),
          estimated_nautical_miles = COALESCE($23::numeric, estimated_nautical_miles),
          vessel_oa_budget = COALESCE($24::numeric, vessel_oa_budget),
          vessel_oa_actual = COALESCE($25::numeric, vessel_oa_actual),
          average_vessel_speed = COALESCE($26::numeric, average_vessel_speed),
          loading_rate = COALESCE($27::numeric, loading_rate),
          discharge_rate = COALESCE($28::numeric, discharge_rate),
          loading_duration_days = COALESCE($29::int, loading_duration_days),
          discharge_duration_days = COALESCE($30::int, discharge_duration_days),
          total_lead_time_days = COALESCE($31::int, total_lead_time_days),
          eta_arrival = COALESCE($32::date, eta_arrival),
          ata_arrival = COALESCE($33::date, ata_arrival),
          eta_sailed = COALESCE($34::date, eta_sailed),
          ata_sailed = COALESCE($35::date, ata_sailed),
          eta_loading_start = COALESCE($36::date, eta_loading_start),
          ata_loading_start = COALESCE($37::date, ata_loading_start),
          eta_loading_complete = COALESCE($38::date, eta_loading_complete),
          ata_loading_complete = COALESCE($39::date, ata_loading_complete),
          eta_discharge_arrival = COALESCE($40::date, eta_discharge_arrival),
          ata_discharge_arrival = COALESCE($41::date, ata_discharge_arrival),
          eta_discharge_start = COALESCE($42::date, eta_discharge_start),
          ata_discharge_start = COALESCE($43::date, ata_discharge_start),
          eta_discharge_complete = COALESCE($44::date, eta_discharge_complete),
          ata_discharge_complete = COALESCE($45::date, ata_discharge_complete),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $46`,
        [
          contractUuid,
          voyageNo,
          vesselCode,
          vesselOwner,
          vesselDraft,
          vesselLoa,
          vesselCapacity,
          vesselHullType,
          vesselRegistrationYear,
          charterType,
          loadingMethod,
          dischargeMethod,
          portOfLoading,
          portOfDischarge,
          shipmentDate,
          arrivalDate,
          quantityShipped,
          quantityDelivered,
          blQuantity,
          actualVesselQtyReceive,
          difference,
          estimatedKm,
          estimatedNm,
          vesselOaBudget,
          vesselOaActual,
          averageVesselSpeed,
          loadingRate,
          dischargeRate,
          loadingDurationDays,
          dischargeDurationDays,
          totalLeadTimeDays,
          etaArrival,
          ataArrival,
          etaSailed,
          ataSailed,
          etaLoadingStart,
          ataLoadingStart,
          etaLoadingComplete,
          ataLoadingComplete,
          etaDischargeArrival,
          ataDischargeArrival,
          etaDischargeStart,
          ataDischargeStart,
          etaDischargeComplete,
          ataDischargeComplete,
          id
        ]
      );
      return id;
    } else if (shipmentIdFromSap) {
      const result = await client.query(
        `INSERT INTO shipments (
          shipment_id, contract_id, status, voyage_no, vessel_code, vessel_name, vessel_owner,
          vessel_draft, vessel_loa, vessel_capacity, vessel_hull_type, vessel_registration_year,
          charter_type, loading_method, discharge_method, port_of_loading, port_of_discharge,
          eta_arrival, ata_arrival, eta_sailed, ata_sailed, shipment_date, arrival_date,
          quantity_shipped, quantity_delivered, bl_quantity, actual_vessel_qty_receive,
          difference_final_qty_vs_bl_qty, estimated_km, estimated_nautical_miles, vessel_oa_budget,
          vessel_oa_actual, average_vessel_speed, eta_loading_start, ata_loading_start,
          eta_loading_complete, ata_loading_complete, eta_discharge_arrival, ata_discharge_arrival,
          eta_discharge_start, ata_discharge_start, eta_discharge_complete, ata_discharge_complete,
          loading_rate, discharge_rate, loading_duration_days, discharge_duration_days,
          total_lead_time_days
        ) VALUES (
          $1, $2::uuid, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12::int,
          $13, $14, $15, $16, $17, $18::date, $19::date, $20::date, $21::date, $22::date, $23::date,
          $24::numeric, $25::numeric, $26::numeric, $27::numeric, $28::numeric, $29::numeric, $30::numeric,
          $31::numeric, $32::numeric, $33::numeric, $34::date, $35::date, $36::date, $37::date,
          $38::date, $39::date, $40::date, $41::date, $42::date, $43::date, $44::numeric, $45::numeric,
          $46::int, $47::int, $48::int
        ) RETURNING id`,
        [
          shipmentIdFromSap,
          contractUuid,
          statusForInsert,
          voyageNo,
          vesselCode,
          vesselName,
          vesselOwner,
          vesselDraft,
          vesselLoa,
          vesselCapacity,
          vesselHullType,
          vesselRegistrationYear,
          charterType,
          loadingMethod,
          dischargeMethod,
          portOfLoading,
          portOfDischarge,
          etaArrival,
          ataArrival,
          etaSailed,
          ataSailed,
          shipmentDate,
          arrivalDate,
          quantityShipped,
          quantityDelivered,
          blQuantity,
          actualVesselQtyReceive,
          difference,
          estimatedKm,
          estimatedNm,
          vesselOaBudget,
          vesselOaActual,
          averageVesselSpeed,
          etaLoadingStart,
          ataLoadingStart,
          etaLoadingComplete,
          ataLoadingComplete,
          etaDischargeArrival,
          ataDischargeArrival,
          etaDischargeStart,
          ataDischargeStart,
          etaDischargeComplete,
          ataDischargeComplete,
          loadingRate,
          dischargeRate,
          loadingDurationDays,
          dischargeDurationDays,
          totalLeadTimeDays
        ]
      );
      return result.rows[0].id;
    }

    // If we reach here, we had neither a direct shipment_id nor a good vessel-name match.
    // Safely skip creating a shipment for this row.
    logger.warn('No suitable shipment target found for SAP row; skipping shipment upsert', {
      shipmentIdFromSap,
      contractId,
      vesselName
    });
    return '';
  }
  
  /**
   * Create or update vessel loading ports
   */
  private static async upsertVesselLoadingPorts(
    client: PoolClient,
    shipmentId: string,
    parsedData: any
  ): Promise<void> {
    if (!shipmentId) return;
    
    const shipmentData = parsedData.shipment || {};

    const qualityByLocation = new Map<string, Record<string, any>>();
    if (Array.isArray(parsedData.quality)) {
      for (const qualityItem of parsedData.quality) {
        if (!qualityItem || !qualityItem.location) continue;
        qualityByLocation.set(qualityItem.location, qualityItem.data || {});
      }
    }

    const mapQualityColumns = (location: string) => {
      const qualityData = qualityByLocation.get(location);
      const mapped: any = {};
      if (!qualityData) {
        return mapped;
      }

      for (const [key, rawValue] of Object.entries(qualityData)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes('ffa')) {
          mapped.quality_ffa = this.parseNumber(rawValue);
        } else if (normalizedKey.includes('m_i') || normalizedKey.includes('mi') || normalizedKey.includes('moisture')) {
          mapped.quality_mi = this.parseNumber(rawValue);
        } else if (normalizedKey.includes('dobi')) {
          mapped.quality_dobi = this.parseNumber(rawValue);
        } else if (normalizedKey.includes('red')) {
          mapped.quality_red = this.parseNumber(rawValue);
        } else if (normalizedKey.includes('d_s') || normalizedKey.includes('d&s') || normalizedKey.includes('ds')) {
          mapped.quality_ds = this.parseNumber(rawValue);
        } else if (normalizedKey.includes('stone')) {
          mapped.quality_stone = this.parseNumber(rawValue);
        }
      }

      return mapped;
    };

    const loadingPorts: Array<Record<string, any>> = [];

    // Loading Port 1
    if (shipmentData.vessel_loading_port_1 || shipmentData.quantity_at_loading_port_1_based_on_bast || qualityByLocation.has('Loading Port 1')) {
      loadingPorts.push({
        port_name: shipmentData.vessel_loading_port_1 || 'Loading Port 1',
        port_sequence: 1,
        quantity_at_loading_port: this.parseNumber(shipmentData.quantity_at_loading_port_1_based_on_bast),
        eta_vessel_arrival: this.parseDate(shipmentData.eta_vessel_arrival_loading_port_1),
        ata_vessel_arrival: this.parseDate(shipmentData.ata_vessel_arrival_at_loading_port_1),
        eta_vessel_berthed: this.parseDate(shipmentData.eta_vessel_berthed_at_loading_port_1),
        ata_vessel_berthed: this.parseDate(shipmentData.ata_vessel_berthed_at_loading_port_1),
        eta_loading_start: this.parseDate(shipmentData.eta_loading_start_at_loading_port_1),
        ata_loading_start: this.parseDate(shipmentData.ata_loading_start_at_loading_port_1 ?? shipmentData.ata_vessel_start_loading),
        eta_loading_completed: this.parseDate(shipmentData.eta_loading_completed_at_loading_port_1),
        ata_loading_completed: this.parseDate(shipmentData.ata_loading_completed_at_loading_port_1 ?? shipmentData.ata_vessel_completed_loading),
        eta_vessel_sailed: this.parseDate(shipmentData.eta_vessel_sailed_at_loading_port_1),
        ata_vessel_sailed: this.parseDate(shipmentData.ata_vessel_sailed_at_loading_port_1 ?? shipmentData.ata_vessel_sailed_from_loading_port),
        loading_rate: this.parseNumber(shipmentData.loading_rate_at_loading_port_1),
        is_discharge_port: false,
        ...mapQualityColumns('Loading Port 1')
      });
    }

    // Loading Port 2
    if (shipmentData.vessel_loading_port_2 || shipmentData.quantity_at_loading_port_2 || qualityByLocation.has('Loading Port 2')) {
      loadingPorts.push({
        port_name: shipmentData.vessel_loading_port_2 || 'Loading Port 2',
        port_sequence: 2,
        quantity_at_loading_port: this.parseNumber(shipmentData.quantity_at_loading_port_2),
        eta_vessel_arrival: this.parseDate(shipmentData.eta_vessel_arrival_at_loading_port_2),
        ata_vessel_arrival: this.parseDate(shipmentData.ata_vessel_arrival_at_loading_port_2),
        eta_vessel_berthed: this.parseDate(shipmentData.eta_vessel_berthed_at_loading_port_2),
        ata_vessel_berthed: this.parseDate(shipmentData.ata_vessel_berthed_at_loading_port_2),
        eta_loading_start: this.parseDate(shipmentData.eta_loading_start_at_loading_port_2),
        ata_loading_start: this.parseDate(shipmentData.ata_loading_start_at_loading_port_2),
        eta_loading_completed: this.parseDate(shipmentData.eta_loading_completed_at_loading_port_2),
        ata_loading_completed: this.parseDate(shipmentData.ata_loading_completed_at_loading_port_2),
        eta_vessel_sailed: this.parseDate(shipmentData.eta_vessel_sailed_at_loading_port_2),
        ata_vessel_sailed: this.parseDate(shipmentData.ata_vessel_sailed_at_loading_port_2),
        loading_rate: this.parseNumber(shipmentData.loading_rate_at_loading_port_2),
        is_discharge_port: false,
        ...mapQualityColumns('Loading Port 2')
      });
    }

    // Loading Port 3
    if (shipmentData.vessel_loading_port_3 || shipmentData.quantity_at_loading_port_3 || qualityByLocation.has('Loading Port 3')) {
      loadingPorts.push({
        port_name: shipmentData.vessel_loading_port_3 || 'Loading Port 3',
        port_sequence: 3,
        quantity_at_loading_port: this.parseNumber(shipmentData.quantity_at_loading_port_3),
        eta_vessel_arrival: this.parseDate(shipmentData.eta_vessel_arrival_at_loading_port_3),
        ata_vessel_arrival: this.parseDate(shipmentData.ata_vessel_arrival_at_loading_port_3),
        eta_vessel_berthed: this.parseDate(shipmentData.eta_vessel_berthed_at_loading_port_3),
        ata_vessel_berthed: this.parseDate(shipmentData.ata_vessel_berthed_at_loading_port_3),
        eta_loading_start: this.parseDate(shipmentData.eta_loading_start_at_loading_port_3),
        ata_loading_start: this.parseDate(shipmentData.ata_loading_start_at_loading_port_3),
        eta_loading_completed: this.parseDate(shipmentData.eta_loading_completed_at_loading_port_3),
        ata_loading_completed: this.parseDate(shipmentData.ata_loading_completed_at_loading_port_3),
        eta_vessel_sailed: this.parseDate(shipmentData.eta_vessel_sailed_at_loading_port_3),
        ata_vessel_sailed: this.parseDate(shipmentData.ata_vessel_sailed_at_loading_port_3),
        loading_rate: this.parseNumber(shipmentData.loading_rate_at_loading_port_3),
        is_discharge_port: false,
        ...mapQualityColumns('Loading Port 3')
      });
    }

    // Discharge Port entry (if data available)
    const dischargeQuality = mapQualityColumns('Discharge Port');
    const dischargePortName = shipmentData.vessel_discharge_port || shipmentData.port_of_discharge || null;
    const dischargeQuantity = this.parseNumber(shipmentData.actual_vessel_qty_receive ?? shipmentData.quantity_delivered);
    const dischargeRate = this.parseNumber(shipmentData.discharge_rate_at_discharging_port);

    if (dischargePortName || Object.keys(dischargeQuality).length > 0) {
      loadingPorts.push({
        port_name: dischargePortName || 'Discharge Port',
        port_sequence: 999,
        quantity_at_loading_port: dischargeQuantity,
        eta_vessel_arrival: this.parseDate(shipmentData.eta_arrival_at_discharge_port),
        ata_vessel_arrival: this.parseDate(shipmentData.ata_vessel_arrival_at_discharge_port),
        eta_vessel_berthed: this.parseDate(shipmentData.eta_vessel_berthed_at_discharge_port),
        ata_vessel_berthed: this.parseDate(shipmentData.ata_vessel_berthed_at_discharge_port),
        eta_loading_start: this.parseDate(shipmentData.eta_discharging_start_at_discharge_port),
        ata_loading_start: this.parseDate(shipmentData.ata_discharging_start_at_discharge_port ?? shipmentData.ata_vessel_start_discharging),
        eta_loading_completed: this.parseDate(shipmentData.eta_discharging_completed_at_discharge_port),
        ata_loading_completed: this.parseDate(shipmentData.ata_discharging_completed_at_discharge_port ?? shipmentData.ata_vessel_completed_discharge),
        eta_vessel_sailed: this.parseDate(shipmentData.eta_discharging_completed_at_discharge_port),
        ata_vessel_sailed: this.parseDate(shipmentData.ata_discharging_completed_at_discharge_port ?? shipmentData.ata_vessel_completed_discharge),
        loading_rate: dischargeRate,
        is_discharge_port: true,
        ...dischargeQuality
      });
    }

    for (const port of loadingPorts) {
      if (!port.port_name) {
        continue;
      }

      const existing = await client.query(
        `SELECT id FROM vessel_loading_ports 
         WHERE shipment_id = $1 
           AND port_sequence = $2
           AND COALESCE(is_discharge_port, false) = $3
         LIMIT 1`,
        [shipmentId, port.port_sequence, port.is_discharge_port === true]
      );

      if (existing.rows.length > 0) {
        const updateValues = [
          existing.rows[0].id,
          port.port_name,
          port.port_sequence,
          port.quantity_at_loading_port,
          port.eta_vessel_arrival,
          port.ata_vessel_arrival,
          port.eta_vessel_berthed,
          port.ata_vessel_berthed,
          port.eta_loading_start,
          port.ata_loading_start,
          port.eta_loading_completed,
          port.ata_loading_completed,
          port.eta_vessel_sailed,
          port.ata_vessel_sailed,
          port.loading_rate,
          port.quality_ffa ?? null,
          port.quality_mi ?? null,
          port.quality_dobi ?? null,
          port.quality_red ?? null,
          port.quality_ds ?? null,
          port.quality_stone ?? null,
          port.is_discharge_port === true,
          shipmentId
        ];

        await client.query(
          `UPDATE vessel_loading_ports SET
             port_name = $2,
             port_sequence = $3,
             quantity_at_loading_port = $4::numeric,
             eta_vessel_arrival = $5::timestamp,
             ata_vessel_arrival = $6::timestamp,
             eta_vessel_berthed = $7::timestamp,
             ata_vessel_berthed = $8::timestamp,
             eta_loading_start = $9::timestamp,
             ata_loading_start = $10::timestamp,
             eta_loading_completed = $11::timestamp,
             ata_loading_completed = $12::timestamp,
             eta_vessel_sailed = $13::timestamp,
             ata_vessel_sailed = $14::timestamp,
             loading_rate = $15::numeric,
             quality_ffa = $16::numeric,
             quality_mi = $17::numeric,
             quality_dobi = $18::numeric,
             quality_red = $19::numeric,
             quality_ds = $20::numeric,
             quality_stone = $21::numeric,
             is_discharge_port = $22::boolean,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND shipment_id = $23`,
          updateValues
        );
      } else {
        await client.query(
          `INSERT INTO vessel_loading_ports (
             shipment_id, port_name, port_sequence, quantity_at_loading_port,
             eta_vessel_arrival, ata_vessel_arrival, eta_vessel_berthed, ata_vessel_berthed,
             eta_loading_start, ata_loading_start, eta_loading_completed, ata_loading_completed,
             eta_vessel_sailed, ata_vessel_sailed, loading_rate,
             quality_ffa, quality_mi, quality_dobi, quality_red, quality_ds, quality_stone,
             is_discharge_port
           ) VALUES (
             $1::uuid, $2, $3, $4::numeric,
             $5::timestamp, $6::timestamp, $7::timestamp, $8::timestamp,
             $9::timestamp, $10::timestamp, $11::timestamp, $12::timestamp,
             $13::timestamp, $14::timestamp, $15::numeric,
             $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20::numeric, $21::numeric,
             $22::boolean
           )`,
          [
            shipmentId,
            port.port_name,
            port.port_sequence,
            port.quantity_at_loading_port,
            port.eta_vessel_arrival,
            port.ata_vessel_arrival,
            port.eta_vessel_berthed,
            port.ata_vessel_berthed,
            port.eta_loading_start,
            port.ata_loading_start,
            port.eta_loading_completed,
            port.ata_loading_completed,
            port.eta_vessel_sailed,
            port.ata_vessel_sailed,
            port.loading_rate,
            port.quality_ffa ?? null,
            port.quality_mi ?? null,
            port.quality_dobi ?? null,
            port.quality_red ?? null,
            port.quality_ds ?? null,
            port.quality_stone ?? null,
            port.is_discharge_port === true
          ]
        );
      }
    }
  }
  
  /**
   * Create quality survey
   */
  private static async createQualitySurvey(
    client: PoolClient,
    shipmentId: string | undefined,
    qualityData: any
  ): Promise<string | null> {
    const shipmentUuid = this.toUuid(shipmentId);
    if (!shipmentUuid) return null;
    
    const data = qualityData.data;
    if (!data || Object.keys(data).length === 0) return null;
    
    const result = await client.query(
      `INSERT INTO quality_surveys (
        shipment_id, location, ffa, moisture, impurity, iv, dobi, color_red, dirt_sand, stone
      ) VALUES (
        $1::uuid, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, 
        $7::numeric, $8::numeric, $9::numeric, $10::numeric
      ) RETURNING id`,
      [
        shipmentUuid,
        qualityData.location,
        this.parseNumber(data.ffa),
        this.parseNumber(data.m_i),
        this.parseNumber(data.m_i), // M&I covers moisture and impurity
        this.parseNumber(data.iv),
        this.parseNumber(data.dobi),
        this.parseNumber(data.color_red),
        this.parseNumber(data.d_s),
        this.parseNumber(data.stone)
      ]
    );
    
    return result.rows[0].id;
  }
  
  /**
   * Create or update trucking operation
   */
  private static async createTruckingOperation(
    client: PoolClient,
    shipmentId: string | undefined,
    contractId: string | undefined,
    truckingData: any
  ): Promise<string | null> {
    const shipmentUuid = this.toUuid(shipmentId);
    const contractUuid = this.toUuid(contractId);
    if (!shipmentUuid && !contractUuid) return null;
    
    const data = truckingData.data;
    if (!data || Object.keys(data).length === 0) return null;
    
    // Filter out invalid values like '0.00' for string fields
    let loadingLocation = data.truck_loading_at_starting_location;
    if (loadingLocation && (loadingLocation === '0.00' || loadingLocation.trim() === '')) {
      loadingLocation = null;
    }
    
    let unloadingLocation = data.truck_unloading_at_starting_location;
    if (unloadingLocation && (unloadingLocation === '0.00' || unloadingLocation.trim() === '')) {
      unloadingLocation = null;
    }

    // Derive a generic plant/location value for filters and dashboards
    const location = unloadingLocation || loadingLocation || null;
    
    const startDate = this.parseDate(data.trucking_starting_date_at_starting_location);
    const completionDate = this.parseDate(data.trucking_completion_date_at_starting_location);
    const status =
      completionDate != null ? 'COMPLETED' :
      startDate != null ? 'IN_PROGRESS' :
      'PLANNED';

    const truckingOwner = data.trucking_owner_at_starting_location;

    // Try to find existing trucking operation by contract + similar trucking owner (>= 0.8)
    let targetTruckingId: string | null = null;
    if (contractUuid && truckingOwner) {
      const existingForContract = await client.query(
        `SELECT id, trucking_owner FROM trucking_operations WHERE contract_id = $1`,
        [contractUuid]
      );

      let bestId: string | null = null;
      let bestScore = 0;
      for (const row of existingForContract.rows) {
        const score = this.stringSimilarity(truckingOwner, row.trucking_owner);
        if (score > bestScore) {
          bestScore = score;
          bestId = row.id;
        }
      }

      if (bestId && bestScore >= 0.8) {
        targetTruckingId = bestId;
      }
    }

    if (targetTruckingId) {
      // Update existing trucking operation, but do NOT override:
      // - status
      // - eta_delivery_start_date, eta_delivery_end_date
      // - eta_trucking_start_date, eta_trucking_completion_date
      await client.query(
        `UPDATE trucking_operations SET
          shipment_id = COALESCE($1::uuid, shipment_id),
          location_sequence = COALESCE($2, location_sequence),
          cargo_readiness_date = COALESCE($3::date, cargo_readiness_date),
          loading_location = COALESCE($4, loading_location),
          unloading_location = COALESCE($5, unloading_location),
          location = COALESCE($6, location),
          trucking_owner = COALESCE($7, trucking_owner),
          oa_budget = COALESCE($8::numeric, oa_budget),
          oa_actual = COALESCE($9::numeric, oa_actual),
          quantity_sent = COALESCE($10::numeric, quantity_sent),
          quantity_delivered = COALESCE($11::numeric, quantity_delivered),
          gain_loss = COALESCE($12::numeric, gain_loss),
          trucking_start_date = COALESCE($13::date, trucking_start_date),
          trucking_completion_date = COALESCE($14::date, trucking_completion_date),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $15`,
        [
          shipmentUuid,
          truckingData.sequence,
          this.parseDate(data.cargo_readiness_at_starting_location),
          loadingLocation,
          unloadingLocation,
          location,
          truckingOwner,
          this.parseNumber(data.trucking_oa_budget_at_starting_location),
          this.parseNumber(data.trucking_oa_actual_at_starting_location),
          this.parseNumber(data.quantity_sent_via_trucking_based_on_surat_jalan),
          this.parseNumber(data.quantity_delivered_via_trucking),
          this.parseNumber(data.trucking_gain_loss_at_starting_location),
          startDate,
          completionDate,
          targetTruckingId
        ]
      );
      return targetTruckingId;
    }

    const result = await client.query(
      `INSERT INTO trucking_operations (
        shipment_id, contract_id, location_sequence, cargo_readiness_date,
        loading_location, unloading_location, location, trucking_owner,
        oa_budget, oa_actual, quantity_sent, quantity_delivered, gain_loss,
        trucking_start_date, trucking_completion_date, status
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4::date, $5, $6, $7, $8,
        $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13::numeric,
        $14::date, $15::date, $16
      ) RETURNING id`,
      [
        shipmentUuid,
        contractUuid,
        truckingData.sequence,
        this.parseDate(data.cargo_readiness_at_starting_location),
        loadingLocation,
        unloadingLocation,
        location,
        truckingOwner,
        this.parseNumber(data.trucking_oa_budget_at_starting_location),
        this.parseNumber(data.trucking_oa_actual_at_starting_location),
        this.parseNumber(data.quantity_sent_via_trucking_based_on_surat_jalan),
        this.parseNumber(data.quantity_delivered_via_trucking),
        this.parseNumber(data.trucking_gain_loss_at_starting_location),
        startDate,
        completionDate,
        status
      ]
    );
    
    return result.rows[0].id;
  }
  
  /**
   * Create or update payment
   */
  private static async upsertPayment(
    client: PoolClient,
    paymentData: any,
    contractId: string | undefined
  ): Promise<string> {
    const contractUuid = this.toUuid(contractId);
    if (!contractUuid) {
      throw new Error('Contract ID is required for payment');
    }

    const contractRow = await client.query(
      `SELECT contract_value, quantity_ordered, unit_price FROM contracts WHERE id = $1 LIMIT 1`,
      [contractUuid]
    );
    const amount =
      contractRow.rows[0]?.contract_value != null
        ? Number(contractRow.rows[0].contract_value)
        : contractRow.rows[0]?.quantity_ordered != null && contractRow.rows[0]?.unit_price != null
          ? Number(contractRow.rows[0].quantity_ordered) * Number(contractRow.rows[0].unit_price)
          : 0;

    const paymentAmount = paymentData?.payment_amount != null ? this.parseNumber(paymentData.payment_amount) : null;
    const finalAmount = paymentAmount != null ? paymentAmount : amount;

    // Check if payment exists for this contract
    const existing = await client.query(
      `SELECT id FROM payments WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [contractUuid]
    );

    if (existing.rows.length > 0) {
      // Update existing payment (including amount from contract if currently 0)
      const paymentId = existing.rows[0].id;
      await client.query(
        `UPDATE payments SET
          payment_due_date = COALESCE($1::date, payment_due_date),
          dp_date = COALESCE($2::date, dp_date),
          payoff_date = COALESCE($3::date, payoff_date),
          payment_date = COALESCE($4::date, payment_date),
          payment_deviation_days = COALESCE($5::int, payment_deviation_days),
          payment_amount = CASE WHEN payment_amount = 0 OR payment_amount IS NULL THEN $6::numeric ELSE payment_amount END,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [
          this.parseDate(paymentData.due_date_payment),
          this.parseDate(paymentData.dp_date),
          this.parseDate(paymentData.payoff_date),
          this.parseDate(paymentData.payoff_date),
          this.parseNumber(paymentData.payment_date_deviation_days),
          finalAmount,
          paymentId
        ]
      );
      return paymentId;
    } else {
      const result = await client.query(
        `INSERT INTO payments (
          contract_id, payment_due_date, dp_date, payoff_date, payment_date,
          payment_deviation_days, payment_status, payment_amount
        ) VALUES (
          $1::uuid, $2::date, $3::date, $4::date, $5::date, $6::int, 'PENDING', $7::numeric
        ) RETURNING id`,
        [
          contractUuid,
          this.parseDate(paymentData.due_date_payment),
          this.parseDate(paymentData.dp_date),
          this.parseDate(paymentData.payoff_date),
          this.parseDate(paymentData.payoff_date),
          this.parseNumber(paymentData.payment_date_deviation_days),
          finalAmount
        ]
      );
      return result.rows[0].id;
    }
  }
  
  /**
   * Helper: Check if has contract data
   */
  private static hasContractData(contractData: any, parsedData?: any): boolean {
    if (!contractData) return false;
    // Accept if we have either a contract number or a PO number (common cases)
    if (contractData.contract_no || contractData.po_no) return true;
    // Relax condition: allow when STO exists and we have key attributes to update
    const hasSto = parsedData?.shipment?.sto_no || contractData?.sto_no;
    const hasBasicAttrs =
      !!(contractData.group || contractData.supplier || contractData.product || contractData.contract_quantity);
    return !!(hasSto && hasBasicAttrs);
  }
  
  /**
   * Helper: Check if has shipment data
   */
  private static hasShipmentData(shipmentData: any): boolean {
    if (!shipmentData) return false;

    // Strong identifiers
    if (shipmentData.shipment_id || shipmentData.sto_no) {
      return true;
    }

    // If we have key vessel/port/quantity or ETA/ATA fields populated, we still
    // want to treat this row as shipment data so we can update an existing
    // shipment (matched by contract + vessel) without requiring shipment_id/STO.
    const candidateKeys = [
      // Vessel identity
      'vessel_name',
      'vessel_code',
      'vessel_owner',
      // Ports
      'vessel_loading_port_1',
      'vessel_discharge_port',
      'port_of_loading',
      'port_of_discharge',
      // Quantities
      'quantity_at_loading_port_1_based_on_bast',
      'quantity_shipped',
      'quantity_delivered',
      'bl_quantity',
      // ETA / ATA fields at loading port
      'eta_vessel_arrival_loading_port_1',
      'eta_loading_start_at_loading_port_1',
      'eta_loading_completed_at_loading_port_1',
      'eta_vessel_sailed_at_loading_port_1',
      'ata_vessel_arrival_at_loading_port_1',
      'ata_vessel_berthed_at_loading_port_1',
      'ata_vessel_start_loading',
      'ata_vessel_completed_loading',
      'ata_vessel_sailed_from_loading_port',
      // ETA / ATA fields at discharge port
      'eta_arrival_at_discharge_port',
      'eta_discharging_start_at_discharge_port',
      'eta_discharging_completed_at_discharge_port',
      'ata_vessel_arrival_at_discharge_port',
      'ata_discharging_start_at_discharge_port',
      'ata_vessel_start_discharging',
      'ata_discharging_completed_at_discharge_port',
      'ata_vessel_completed_discharge'
    ];

    return candidateKeys.some((key) => {
      const value = (shipmentData as any)[key];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
  }
  
  /**
   * Helper: Check if has payment data
   */
  private static hasPaymentData(paymentData: any): boolean {
    return paymentData && Object.keys(paymentData).length > 0;
  }
  
  /**
   * Helper: Parse date from various formats
   */
  private static parseDate(value: any): string | null {
    if (!value) return null;
    
    try {
      // Handle Excel date formats
      if (typeof value === 'string') {
        // Try explicit MM/DD/YY(YY) first (observed in data: e.g., 1/31/25)
        const mdYMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (mdYMatch) {
          const m = parseInt(mdYMatch[1], 10);
          const d = parseInt(mdYMatch[2], 10);
          let y = parseInt(mdYMatch[3], 10);
          if (mdYMatch[3].length === 2) {
            y = 2000 + y;
          }
          if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            const iso = new Date(Date.UTC(y, m - 1, d)).toISOString().split('T')[0];
            return iso;
          }
        }
        
        // Try different general formats
        const formats = [
          /(\d{1,2})-([A-Za-z]{3})-(\d{2})/,  // 1-Sep-25
          /(\d{4})-(\d{2})-(\d{2})/,          // 2025-09-01
          /(\d{2})\/(\d{2})\/(\d{4})/         // 01/09/2025
        ];
        
        for (const format of formats) {
          const match = value.match(format);
          if (match) {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              return date.toISOString().split('T')[0];
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  private static parseInteger(value: any): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    try {
      const cleaned = typeof value === 'string'
        ? value.replace(/[^0-9\-]/g, '')
        : value;
      const parsed = parseInt(cleaned, 10);
      return Number.isNaN(parsed) ? null : parsed;
    } catch (error) {
      return null;
    }
  }

  /**
   * Compute a simple similarity ratio between two strings (0.0 - 1.0)
   * using normalized Levenshtein distance. Good enough for 80% "similarity" checks.
   */
  private static stringSimilarity(a?: string | null, b?: string | null): number {
    const s1 = (a || '').trim().toUpperCase();
    const s2 = (b || '').trim().toUpperCase();
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const len1 = s1.length;
    const len2 = s2.length;
    const dp: number[][] = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    const distance = dp[len1][len2];
    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : 1 - distance / maxLen;
  }

  /**
   * Helper: Parse number from various formats
   */
  private static parseNumber(value: any): number | null {
    if (!value) return null;
    
    try {
      // Remove commas and spaces
      const cleaned = typeof value === 'string' 
        ? value.replace(/[,\s]/g, '')
        : value;
      
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    } catch (error) {
      return null;
    }
  }
}

