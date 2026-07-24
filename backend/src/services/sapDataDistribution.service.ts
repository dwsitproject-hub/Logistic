import { PoolClient } from 'pg';
import logger from '../utils/logger';
import { isLandSapRowEligibleForTruckingCreation } from '../utils/landTruckingEligibility';
import {
  isTruckingPageIncoterm,
  resolveTruckingIncotermFromParsedData,
} from '../utils/truckingIncotermScope';
import { isSeaSapRowEligibleForShipmentCreation } from '../utils/seaShipmentEligibility';
import { deriveShipmentStatus, sqlShipmentStatusRank } from '../utils/shipmentStatus';
import {
  SQL_CONTRACT_IMPORT_STATUS,
  isContractDeliveryClosed,
  sqlContractImportStatusForStoExpr,
} from '../utils/contractDeliveryStatus';
import { resolveSapVesselIdentity } from '../utils/sapVesselFields';
import { resolveSapTruckingQuantityDelivered } from '../utils/sapMasterV2UatFormat';
import { ensureMasterVesselFromSap } from './masterVesselFromSap.service';
import {
  denormalizeShipmentPortsFromSap,
  resolvePrimarySapDischargePortText,
  resolvePrimarySapLoadingPortText,
  upsertVesselLoadingPortsFromSapData,
} from './vesselLoadingPortsFromSap.service';
import {
  upsertTruckingRealization,
} from './truckingRealization.service';
import {
  finalizeSapShipmentAfterUpsert,
  findKlipPlannedStoSupersedeCandidate,
  findSapShipmentSupersedeCandidate,
  findShipmentByPoAndSto,
  hasKlipShipmentActivity,
  hasKlipTruckingActivity,
  isSapSourcedShipmentId,
  finalizeSapTruckingAfterUpsert,
} from '../utils/klipLogisticsActivity';
import {
  buildShipmentKlipProtectedSetSql,
  buildTruckingKlipProtectedSetSql,
} from '../utils/klipSapFieldMerge';
import { sqlHasTruckingKlipPlanning } from '../utils/truckingEffectiveStatus';
import { SQL_TRUCKING_KEEPER_PRIORITY_ORDER } from '../utils/truckingOperationUniqueness';
import { mergeContractRecords, mergeDuplicateContractsByPo } from './contractMerge.service';
import { normalizePoNumber } from '../utils/contractPoIdentity';

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
   * Normalize SAP "Sea / Land" / transport_mode cell to SEA or LAND.
   * Returns null for blank or ambiguous combined values (e.g. "SEA / LAND").
   */
  private static parseTransportModeLabel(raw: unknown): 'SEA' | 'LAND' | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const u = s.toUpperCase().replace(/\s+/g, ' ').trim();
    if (/SEA.*LAND|LAND.*SEA/.test(u)) return null;
    if (u === 'SEA' || u.startsWith('SEA ') || u.startsWith('SEA/')) return 'SEA';
    if (u === 'LAND' || u.startsWith('LAND ') || u.startsWith('LAND/')) return 'LAND';
    return null;
  }

  /** After upsert, contracts.transport_mode may still be SEA/LAND from a prior row (COALESCE keeps old value when the row is blank). */
  private static async resolveTransportModeRaw(
    client: PoolClient,
    contractUuid: string | undefined,
    parsedContract: any
  ): Promise<string | null> {
    let raw = parsedContract?.sea_land ?? parsedContract?.transport_mode ?? null;
    if (raw != null && String(raw).trim() !== '') {
      return String(raw).trim();
    }
    if (!contractUuid) return null;
    const r = await client.query(
      `SELECT transport_mode FROM contracts WHERE id = $1`,
      [contractUuid]
    );
    const dbVal = r.rows[0]?.transport_mode;
    if (dbVal != null && String(dbVal).trim() !== '') {
      return String(dbVal).trim();
    }
    return null;
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
    const poNorm = normalizePoNumber(poNumber);
    if (poNorm) {
      const existing = await client.query(
        `SELECT id FROM contracts WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text) LIMIT 1`,
        [poNorm],
      );
      if (existing.rows.length > 0) {
        return existing.rows[0].id as string;
      }
    }
    if (contractNumber) {
      const existing = await client.query(
        `SELECT id FROM contracts WHERE contract_id = $1 LIMIT 1`,
        [contractNumber],
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
      // Prefer current row, then DB (upsert uses COALESCE — blank row keeps existing transport_mode)
      const seaLandRaw = await this.resolveTransportModeRaw(
        client,
        result.contractId,
        parsedData.contract
      );
      const modeLabel = this.parseTransportModeLabel(seaLandRaw);
      const isLand = modeLabel === 'LAND';
      const isSea = modeLabel === 'SEA';
      const incotermLabel = resolveTruckingIncotermFromParsedData(parsedData);
      const isTruckIncoterm = isTruckingPageIncoterm(incotermLabel);
      const hasShipment = this.hasShipmentData(parsedData.shipment);
      const seaEligible = isSeaSapRowEligibleForShipmentCreation(parsedData);
      const hasVesselLike =
        !!(
          parsedData.shipment?.vessel_name ||
          parsedData.shipment?.vessel_code ||
          parsedData.shipment?.voyage_no ||
          parsedData.shipment?.vessel_owner ||
          parsedData.shipment?.vessel_loading_port_1 ||
          parsedData.shipment?.vessel_discharge_port
        );
      const hasStoInShipment = !!(
        parsedData.shipment?.sto_no ||
        parsedData.shipment?.shipment_id
      );
      // If mode is still unknown, infer SEA when we have STO/shipment identifiers but no explicit LAND
      const assumeSea =
        !isLand &&
        !isSea &&
        hasShipment &&
        (hasVesselLike || hasStoInShipment);
      
      const seaLike = isSea || assumeSea;

      logger.info('Routing decision based on SEA / LAND:', {
        sea_land_raw: seaLandRaw,
        modeLabel,
        incotermLabel,
        isTruckIncoterm,
        isLand,
        isSea: seaLike,
        hasShipmentData: hasShipment,
        assumedSea: assumeSea
      });
      
      // 2a. SEA: create/update shipment only when SAP row has at least one shipping anchor field
      // (STO No, ports, vessel, STO qty, qty delivery/receive, ATA milestones — see seaShipmentEligibility).
      // FRC/LCO incoterms route to trucking even when SAP Sea/Land is inconsistent.
      if (seaLike && hasShipment && seaEligible && !isTruckIncoterm) {
        try {
          // Extract vessel data from shipment object (where it's actually stored)
          const vesselIdentity = resolveSapVesselIdentity(
            parsedData.shipment,
            parsedData.vessel,
            parsedData.raw,
          );
          const vesselData = {
            vessel_name: vesselIdentity.vessel_name,
            vessel_code: vesselIdentity.vessel_code,
            vessel_owner: vesselIdentity.vessel_owner,
            voyage_no: parsedData.shipment?.voyage_no,
            vessel_draft: parsedData.shipment?.vessel_draft,
            vessel_loa: parsedData.shipment?.vessel_loa,
            vessel_capacity: parsedData.shipment?.vessel_capacity,
            vessel_hull_type: parsedData.shipment?.vessel_hull_type,
            vessel_registration_year:
              parsedData.shipment?.vessel_registration_year || parsedData.vessel?.registration_year,
            charter_type: parsedData.shipment?.charter_type || parsedData.vessel?.charter_type,
          };
          
          logger.info('Attempting to upsert shipment with data (SEA):', {
            sto_no: parsedData.shipment?.sto_no,
            vessel_name: vesselData.vessel_name,
            contractId: result.contractId
          });
          const shipmentPayload = { ...(parsedData.shipment || {}) };
          this.enrichShipmentSfalSfbdFromRaw(shipmentPayload, parsedData.raw);

          const shipmentId = await this.upsertShipment(
            client,
            shipmentPayload,
            result.contractId, // ensure we link shipment to whatever contract id we resolved
            vesselData,
            userId,
            parsedData,
          );
          const shipmentUuid = this.toUuid(shipmentId);
          if (!shipmentUuid) {
            result.shipmentId = undefined;
            logger.warn('Shipment upsert returned no UUID; skipping port sync and KLIP activity checks', {
              contractId: result.contractId,
              sto_no: parsedData.shipment?.sto_no,
            });
          } else {
            result.shipmentId = shipmentUuid;
            logger.info('Shipment upserted successfully:', result.shipmentId);

            // Create or update vessel loading ports
            await this.upsertVesselLoadingPorts(client, result.shipmentId, parsedData);
            const klipProtectPorts = await hasKlipShipmentActivity(
              client,
              result.shipmentId,
              result.contractId ?? undefined,
            );
            await denormalizeShipmentPortsFromSap(client, result.shipmentId, parsedData, {
              protectKlip: klipProtectPorts,
            });
            logger.info('Vessel loading ports processed for shipment:', result.shipmentId);
          }
        } catch (shipmentError) {
          logger.error('Failed to upsert shipment:', shipmentError);
          logger.error('Shipment data:', JSON.stringify(parsedData.shipment, null, 2));
          throw shipmentError;
        }
      } else if (seaLike && hasShipment && !seaEligible) {
        logger.info('Skipping SEA shipment upsert: not eligible by anchor fields', {
          contractId: result.contractId,
          sto_no: parsedData.shipment?.sto_no,
        });
      } else if (isTruckIncoterm && isLandSapRowEligibleForTruckingCreation(parsedData)) {
        // 2b. FRC/LCO: use parsedData.trucking[] (columns AV/AW Last/Start Receive) — NOT vessel shipment dates.
        try {
          logger.info('Creating trucking operation(s) from SAP trucking data (FRC/LCO):', {
            sto_no: parsedData.shipment?.sto_no,
            contractId: result.contractId,
            truckingLegs: parsedData.trucking?.length ?? 0,
          });

          const shipmentFallback = {
            sequence: 1,
            data: {
              cargo_readiness_at_starting_location: parsedData.shipment?.eta_vessel_arrival_loading_port_1 || null,
              truck_loading_at_starting_location: parsedData.shipment?.vessel_loading_port_1 || null,
              truck_unloading_at_starting_location: parsedData.shipment?.vessel_discharge_port || null,
              trucking_owner_at_starting_location: parsedData.shipment?.vessel_owner || null,
              trucking_oa_budget_at_starting_location: null,
              trucking_oa_actual_at_starting_location: null,
              quantity_sent_via_trucking_based_on_surat_jalan:
                parsedData.shipment?.quantity_at_loading_port_1_based_on_bast || null,
              quantity_delivered_via_trucking: resolveSapTruckingQuantityDelivered(parsedData),
              trucking_gain_loss_at_starting_location: null,
            },
          };

          const truckingEntries =
            Array.isArray(parsedData.trucking) && parsedData.trucking.length > 0
              ? parsedData.trucking
              : [shipmentFallback];

          for (const entry of truckingEntries) {
            const enriched = this.enrichLandTruckingDataFromRaw(parsedData, entry);
            const truckingId = await this.createTruckingOperation(
              client,
              undefined,
              result.contractId,
              enriched
            );
            if (truckingId) result.truckingOperationIds.push(truckingId);
            logger.info('Trucking operation upserted from SAP (FRC/LCO):', truckingId);
          }
        } catch (truckingError) {
          logger.error('Failed to create trucking operation from SAP (FRC/LCO):', truckingError);
          logger.error('Parsed trucking:', JSON.stringify(parsedData.trucking, null, 2));
          throw truckingError;
        }
      } else {
        logger.info('No shipment/trucking data found to upsert or SEA/LAND value not set');
      }
      
      // 3. Create quality surveys (multiple) - only for SEA shipments
      if (seaLike && parsedData.quality && parsedData.quality.length > 0) {
        for (const qualityData of parsedData.quality) {
          const surveyId = await this.createQualitySurvey(
            client,
            result.shipmentId,
            qualityData
          );
          if (surveyId) result.qualitySurveyIds.push(surveyId);
        }
      }
      
      // 4. Create trucking operations (multiple) - supplementary legs linked to shipment when SEA
      // Note: For LAND, we already created trucking operations above from shipment data (and !isLand skips this block)
      // For SEA: only create trucking legs when a shipment exists to link (avoids STO activity landing only in trucking)
      if (
        seaLike &&
        hasShipment &&
        !result.shipmentId &&
        parsedData.trucking &&
        parsedData.trucking.length > 0
      ) {
        logger.warn(
          'Skipping parsedData.trucking: SEA-like row has shipment data but no shipment id (check shipment upsert / contract link)'
        );
      }
      if (
        !isLand &&
        parsedData.trucking &&
        parsedData.trucking.length > 0 &&
        (!seaLike || !!result.shipmentId)
      ) {
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
   * Move dependent rows from one contract UUID to another (placeholder → real contract).
   */
  private static async mergeContractRecords(
    client: PoolClient,
    fromContractUuid: string,
    toContractUuid: string
  ): Promise<void> {
    await mergeContractRecords(client, fromContractUuid, toContractUuid);
  }

  /**
   * When SAP rows arrive with contract_no + po_no, reconcile any PO-prefixed placeholder.
   * If the real contract_id already exists, merge the placeholder into it instead of renaming
   * (renaming would violate contracts_contract_id_key).
   */
  private static async reconcilePoPlaceholder(
    client: PoolClient,
    contractNumber: string,
    poNumber: string
  ): Promise<void> {
    const placeholderId = `PO-${poNumber}`;
    const placeholder = await client.query(
      `SELECT id FROM contracts WHERE contract_id = $1 LIMIT 1`,
      [placeholderId]
    );
    if (placeholder.rows.length === 0) return;

    const placeholderUuid = placeholder.rows[0].id as string;
    const existingReal = await client.query(
      `SELECT id FROM contracts WHERE contract_id = $1 LIMIT 1`,
      [contractNumber]
    );

    if (existingReal.rows.length > 0) {
      const realUuid = existingReal.rows[0].id as string;
      if (realUuid !== placeholderUuid) {
        logger.info(`Merging placeholder contract ${placeholderId} into existing ${contractNumber}`);
        await this.mergeContractRecords(client, placeholderUuid, realUuid);
      }
      return;
    }

    logger.info(`Renaming placeholder contract ${placeholderId} to ${contractNumber}`);
    await client.query(
      `UPDATE contracts SET contract_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [contractNumber, placeholderUuid]
    );
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
    const poNumber = normalizePoNumber(contractData.po_no);

    if (!poNumber) {
      throw new Error('PO number is required');
    }

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`po:${poNumber}`]);
    await mergeDuplicateContractsByPo(client, poNumber);

    const existingByPo = await client.query<{ id: string; contract_id: string }>(
      `SELECT id, contract_id
       FROM contracts
       WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text)
       LIMIT 1`,
      [poNumber],
    );

    let effectiveContractId =
      contractNumber ||
      (existingByPo.rows[0]?.contract_id && !String(existingByPo.rows[0].contract_id).startsWith('PO-')
        ? existingByPo.rows[0].contract_id
        : null) ||
      `PO-${poNumber}`;

    if (contractNumber && poNumber) {
      await this.reconcilePoPlaceholder(client, contractNumber, poNumber);
      effectiveContractId = contractNumber;
    } else if (!contractNumber && poNumber && existingByPo.rows[0]?.contract_id) {
      const existingCid = String(existingByPo.rows[0].contract_id);
      if (!existingCid.startsWith('PO-')) {
        effectiveContractId = existingCid;
      }
    }

    const quantity = this.parseNumber(contractData.contract_quantity);
    const unitPrice = this.parseNumber(contractData.unit_price);
    const contractValue = (quantity && unitPrice) ? quantity * unitPrice : null;
    const statusNorm = this.normalizeContractStatus(contractData.status) || 'Open';
    const statusForDb = this.statusForDb(statusNorm);

    const params = [
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
      contractData.plant_code || null,
      userId,
    ];

    let contractUuid: string;

    if (existingByPo.rows.length > 0) {
      const existingId = existingByPo.rows[0].id;
      const renameContractId =
        contractNumber &&
        String(existingByPo.rows[0].contract_id).startsWith('PO-') &&
        contractNumber !== existingByPo.rows[0].contract_id;

      if (renameContractId) {
        const conflict = await client.query(
          `SELECT id FROM contracts WHERE contract_id = $1 AND id <> $2::uuid LIMIT 1`,
          [contractNumber, existingId],
        );
        if (conflict.rows.length > 0) {
          await this.mergeContractRecords(client, conflict.rows[0].id, existingId);
        } else {
          await client.query(
            `UPDATE contracts SET contract_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid`,
            [contractNumber, existingId],
          );
        }
      }

      const updated = await client.query(
        `UPDATE contracts SET
          contract_id = CASE
            WHEN $1::text IS NOT NULL AND $1::text !~ '^PO-' THEN $1::text
            ELSE contract_id
          END,
          group_name = COALESCE($2, group_name),
          supplier = COALESCE($3, supplier),
          buyer = COALESCE($4, buyer),
          contract_date = COALESCE($5::date, contract_date),
          product = COALESCE($6, product),
          po_number = COALESCE($7, po_number),
          incoterm = COALESCE($8, incoterm),
          transport_mode = COALESCE($9, transport_mode),
          quantity_ordered = COALESCE($10::numeric, quantity_ordered),
          unit_price = COALESCE($11::numeric, unit_price),
          contract_value = COALESCE($12::numeric, contract_value),
          delivery_start_date = COALESCE($13::date, delivery_start_date),
          delivery_end_date = COALESCE($14::date, delivery_end_date),
          source_type = COALESCE($15, source_type),
          contract_type = COALESCE($16, contract_type),
          status = COALESCE($17, status),
          sto_number = COALESCE($18, sto_number),
          sto_quantity = COALESCE($19::numeric, sto_quantity),
          logistics_classification = COALESCE($20, logistics_classification),
          po_classification = COALESCE($21, po_classification),
          plant_code = COALESCE($22, plant_code),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $23::uuid
         RETURNING id`,
        [...params.slice(0, 22), existingId],
      );
      contractUuid = updated.rows[0].id as string;
    } else {
      const inserted = await client.query(
        `INSERT INTO contracts (
          contract_id, group_name, supplier, buyer, contract_date, product, po_number,
          incoterm, transport_mode, quantity_ordered, unit, unit_price, contract_value,
          delivery_start_date, delivery_end_date, source_type, contract_type,
          status, sto_number, sto_quantity, logistics_classification, po_classification,
          plant_code, created_by
        ) VALUES (
          $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10::numeric, 'MT', $11::numeric, $12::numeric,
          $13::date, $14::date, $15, $16, $17, $18, $19::numeric, $20, $21, $22, $23
        )
        ON CONFLICT (contract_id) DO UPDATE SET
          po_number = COALESCE(EXCLUDED.po_number, contracts.po_number),
          group_name = COALESCE(EXCLUDED.group_name, contracts.group_name),
          supplier = COALESCE(EXCLUDED.supplier, contracts.supplier),
          buyer = COALESCE(EXCLUDED.buyer, contracts.buyer),
          contract_date = COALESCE(EXCLUDED.contract_date, contracts.contract_date),
          product = COALESCE(EXCLUDED.product, contracts.product),
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
          plant_code = COALESCE(EXCLUDED.plant_code, contracts.plant_code),
          updated_at = CURRENT_TIMESTAMP
        RETURNING id`,
        params,
      );
      contractUuid = inserted.rows[0].id as string;
    }

    // Persist each STO as a separate row in contract_stos to support multiple STOs per contract.
    const stoNo = contractData.sto_no != null ? String(contractData.sto_no).trim() || null : null;
    if (stoNo) {
      await client.query(
        `INSERT INTO contract_stos (contract_id, sto_number, sto_quantity, sto_type, sto_item, sto_classification, plant_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (contract_id, sto_number) DO UPDATE SET
           sto_quantity     = COALESCE(EXCLUDED.sto_quantity, contract_stos.sto_quantity),
           sto_type         = COALESCE(EXCLUDED.sto_type, contract_stos.sto_type),
           sto_item         = COALESCE(EXCLUDED.sto_item, contract_stos.sto_item),
           sto_classification = COALESCE(EXCLUDED.sto_classification, contract_stos.sto_classification),
           plant_code       = COALESCE(EXCLUDED.plant_code, contract_stos.plant_code),
           updated_at       = CURRENT_TIMESTAMP`,
        [
          contractUuid,
          stoNo,
          this.parseNumber(contractData.sto_quantity),
          contractData.sto_type || null,
          contractData.sto_item || null,
          contractData.sto_classification || contractData.po_classification || null,
          contractData.plant_code || null
        ]
      );
    }

    return contractUuid;
  }
  
  /**
   * Create or update shipment
   */
  private static async upsertShipment(
    client: PoolClient,
    shipmentData: any,
    contractId: string | undefined,
    vesselData: any,
    _userId?: string,
    parsedData?: Record<string, unknown>,
  ): Promise<string | null> {
    const contractUuid = this.toUuid(contractId);
    const shipmentIdFromSap = shipmentData.shipment_id || shipmentData.sto_no;

    const resolvedVessel = resolveSapVesselIdentity(
      shipmentData,
      vesselData,
      (shipmentData as { raw?: Record<string, unknown> })?.raw,
    );
    const voyageNo = vesselData.voyage_no || shipmentData.voyage_no;
    const vesselCode = resolvedVessel.vessel_code || vesselData.vessel_code || shipmentData.vessel_code;
    const vesselName = resolvedVessel.vessel_name || vesselData.vessel_name || shipmentData.vessel_name;
    const vesselOwner = resolvedVessel.vessel_owner || vesselData.vessel_owner || shipmentData.vessel_owner;

    const vesselDraft = this.parseNumber(shipmentData.vessel_draft ?? vesselData.vessel_draft);
    const vesselLoa = this.parseNumber(shipmentData.vessel_loa ?? vesselData.vessel_loa);
    const vesselCapacity = this.parseNumber(shipmentData.vessel_capacity ?? vesselData.vessel_capacity);
    const vesselHullType = vesselData.vessel_hull_type || shipmentData.vessel_hull_type;
    const vesselRegistrationYear = this.parseInteger(shipmentData.vessel_registration_year ?? vesselData.vessel_registration_year);

    const charterType = vesselData.charter_type || shipmentData.charter_type;
    const loadingMethod = shipmentData.loading_method || null;
    const dischargeMethod = shipmentData.discharge_method || null;

    // Denormalize SAP Vessel Loading/Discharge Port onto shipment shell (list fast-path).
    const sapPortContext =
      parsedData ??
      ({
        shipment: shipmentData,
        raw: (shipmentData as { raw?: Record<string, unknown> })?.raw ?? {},
      } as Record<string, unknown>);
    let portOfLoading = resolvePrimarySapLoadingPortText(sapPortContext);
    if (!portOfLoading) {
      portOfLoading =
        shipmentData.vessel_loading_port_1 ||
        shipmentData.vessel_loading_port ||
        shipmentData.port_of_loading ||
        shipmentData.loading_port ||
        shipmentData.loading_port_1 ||
        null;
    }
    if (portOfLoading && (portOfLoading === '0.00' || portOfLoading.trim() === '')) {
      portOfLoading = null;
    }

    let portOfDischarge = resolvePrimarySapDischargePortText(sapPortContext);
    if (!portOfDischarge) {
      portOfDischarge =
        shipmentData.vessel_discharge_port ||
        shipmentData.port_of_discharge ||
        shipmentData.discharge_port ||
        null;
    }
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
    const sfalQty = this.parseSapFigureQtyKg(shipmentData.sfal, shipmentData.sfal_qty);
    const sfbdQty = this.parseSapFigureQtyKg(shipmentData.sfbd, shipmentData.sfbd_qty);
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

    // Auto-derive SEA shipment status from ATA milestones (management rules).
    // Prefer loading port 1 + discharge port ATA timestamps, fallback to shipment-level fields.
    const ataArrivalLoading = this.parseDate(shipmentData.ata_vessel_arrival_at_loading_port_1 ?? shipmentData.ata_arrival);
    const ataBerthedLoading = this.parseDate(shipmentData.ata_vessel_berthed_at_loading_port_1 ?? shipmentData.ata_berthed);
    const ataSailedLoading = this.parseDate(shipmentData.ata_vessel_sailed_at_loading_port_1 ?? shipmentData.ata_vessel_sailed_from_loading_port ?? shipmentData.ata_sailed);
    const ataDischargeBerthed = this.parseDate(shipmentData.ata_vessel_berthed_at_discharge_port ?? shipmentData.ata_discharge_berthed);

    const contractSapClosed = await this.isContractSapClosedForUuid(
      client,
      contractUuid,
      shipmentIdFromSap ? String(shipmentIdFromSap).trim() : null,
    );

    const statusForInsert = deriveShipmentStatus({
      ata_arrival_at_loading_port: ataArrivalLoading,
      ata_berthed_at_loading_port: ataBerthedLoading,
      ata_start_loading: ataLoadingStart,
      ata_completed_loading: ataLoadingComplete,
      ata_sailed_from_loading_port: ataSailedLoading,
      ata_arrive_at_discharge_port: ataDischargeArrival,
      ata_berthed_at_discharge_port: ataDischargeBerthed,
      ata_start_discharging: ataDischargeStart,
      ata_complete_discharge: ataDischargeComplete,
      contract_import_status: contractSapClosed ? 'Close' : null,
    });

    // Strategy:
    // 1) Prefer direct match by shipment_id from SAP.
    // 2) Otherwise, when contractId + vesselName are present, look for a shipment for this contract
    //    whose vessel_name is at least 80% similar. If found, update that shipment instead of inserting.

    let targetShipmentId: string | null = null;
    let contractPoNumber: string | null = null;
    if (contractUuid) {
      const poRes = await client.query<{ po_number: string | null }>(
        `SELECT po_number FROM contracts WHERE id = $1::uuid LIMIT 1`,
        [contractUuid],
      );
      contractPoNumber = poRes.rows[0]?.po_number ?? null;
    }

    if (shipmentIdFromSap && contractUuid) {
      const existingByShipment = await client.query(
        `SELECT id FROM shipments
         WHERE contract_id = $1::uuid AND shipment_id = $2
         LIMIT 1`,
        [contractUuid, shipmentIdFromSap],
      );
      if (existingByShipment.rows.length > 0) {
        targetShipmentId = existingByShipment.rows[0].id;
      }
    } else if (shipmentIdFromSap) {
      const existingByShipment = await client.query(
        `SELECT id FROM shipments WHERE shipment_id = $1 LIMIT 1`,
        [shipmentIdFromSap],
      );
      if (existingByShipment.rows.length > 0) {
        targetShipmentId = existingByShipment.rows[0].id;
      }
    }

    if (!targetShipmentId && contractUuid && shipmentIdFromSap) {
      const klipSupersedeId = await findKlipPlannedStoSupersedeCandidate(
        client,
        contractUuid,
        String(shipmentIdFromSap).trim(),
        contractPoNumber,
      );
      if (klipSupersedeId) {
        targetShipmentId = klipSupersedeId;
        logger.info('upsertShipment: reusing KLIP-planned shipment for SAP STO change', {
          contractId,
          supersededShipmentUuid: klipSupersedeId,
          sapShipmentId: shipmentIdFromSap,
          poNumber: contractPoNumber,
        });
      }
    }

    if (!targetShipmentId && contractUuid && shipmentIdFromSap) {
      const supersedeId = await findSapShipmentSupersedeCandidate(
        client,
        contractUuid,
        String(shipmentIdFromSap).trim(),
      );
      if (supersedeId) {
        targetShipmentId = supersedeId;
        logger.info('upsertShipment: reusing SAP-only shipment row for new STO from latest upload', {
          contractId,
          supersededShipmentUuid: supersedeId,
          sapShipmentId: shipmentIdFromSap,
        });
      }
    }

    if (!targetShipmentId && contractUuid && isSapSourcedShipmentId(shipmentIdFromSap)) {
      const poMatch = await findShipmentByPoAndSto(
        client,
        contractPoNumber,
        String(shipmentIdFromSap).trim(),
      );
      if (poMatch && poMatch.contractUuid === contractUuid) {
        targetShipmentId = poMatch.id;
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

    // Planned MNL/MSEA shipment on this contract — reuse when SAP assigns STO (even if SAP has vessel name).
    if (!targetShipmentId && contractUuid && shipmentIdFromSap) {
      const existingPlanned = await client.query(
        `SELECT id FROM shipments
         WHERE contract_id = $1
           AND COALESCE(status, '') <> 'CANCELLED'
           AND (shipment_id LIKE 'MNL-%' OR shipment_id LIKE 'MSEA-%')
         ORDER BY created_at DESC LIMIT 1`,
        [contractUuid]
      );
      if (existingPlanned.rows.length > 0) {
        targetShipmentId = existingPlanned.rows[0].id;
        logger.info('upsertShipment: matched planned MNL/MSEA shipment for SAP STO', {
          contractId,
          existingShipmentId: targetShipmentId,
          sapShipmentId: shipmentIdFromSap,
        });
      }
    }

    // SAP re-import: when contract has exactly one active shipment, update it instead of inserting a duplicate.
    if (!targetShipmentId && contractUuid) {
      const soleActive = await client.query<{ id: string }>(
        `SELECT id FROM shipments
         WHERE contract_id = $1::uuid
           AND COALESCE(status, '') <> 'CANCELLED'
         ORDER BY created_at DESC`,
        [contractUuid],
      );
      if (soleActive.rows.length === 1) {
        targetShipmentId = soleActive.rows[0].id;
        logger.info('upsertShipment: reusing sole active shipment on contract for SAP update', {
          contractId,
          existingShipmentId: targetShipmentId,
          sapShipmentId: shipmentIdFromSap,
        });
      }
    }

    if (targetShipmentId) {
      const id = targetShipmentId;
      const klipProtectShipmentFields = await hasKlipShipmentActivity(
        client,
        id,
        contractUuid ?? undefined,
      );
      const shipmentProtectedSql = buildShipmentKlipProtectedSetSql(
        klipProtectShipmentFields,
        'param',
      );
      await client.query(
        `UPDATE shipments SET
          contract_id = COALESCE($1::uuid, contract_id),
          voyage_no = COALESCE($2, voyage_no),
          ${shipmentProtectedSql},
          vessel_owner = COALESCE($5, vessel_owner),
          vessel_draft = COALESCE($6::numeric, vessel_draft),
          vessel_loa = COALESCE($7::numeric, vessel_loa),
          vessel_capacity = COALESCE($8::numeric, vessel_capacity),
          vessel_hull_type = COALESCE($9, vessel_hull_type),
          vessel_registration_year = COALESCE($10::int, vessel_registration_year),
          charter_type = COALESCE($11, charter_type),
          loading_method = COALESCE($12, loading_method),
          discharge_method = COALESCE($13, discharge_method),
          shipment_date = COALESCE($16::date, shipment_date),
          arrival_date = COALESCE($17::date, arrival_date),
          quantity_shipped = COALESCE($18::numeric, quantity_shipped),
          bl_quantity = COALESCE($20::numeric, bl_quantity),
          difference_final_qty_vs_bl_qty = COALESCE($22::numeric, difference_final_qty_vs_bl_qty),
          estimated_km = COALESCE($23::numeric, estimated_km),
          estimated_nautical_miles = COALESCE($24::numeric, estimated_nautical_miles),
          vessel_oa_budget = COALESCE($25::numeric, vessel_oa_budget),
          vessel_oa_actual = COALESCE($26::numeric, vessel_oa_actual),
          average_vessel_speed = COALESCE($27::numeric, average_vessel_speed),
          loading_rate = COALESCE($28::numeric, loading_rate),
          discharge_rate = COALESCE($29::numeric, discharge_rate),
          loading_duration_days = COALESCE($30::int, loading_duration_days),
          discharge_duration_days = COALESCE($31::int, discharge_duration_days),
          total_lead_time_days = COALESCE($32::int, total_lead_time_days),
          eta_arrival = COALESCE($33::date, eta_arrival),
          ata_arrival = COALESCE($34::date, ata_arrival),
          eta_sailed = COALESCE($35::date, eta_sailed),
          ata_sailed = COALESCE($36::date, ata_sailed),
          eta_loading_start = COALESCE($37::date, eta_loading_start),
          ata_loading_start = COALESCE($38::date, ata_loading_start),
          eta_loading_complete = COALESCE($39::date, eta_loading_complete),
          ata_loading_complete = COALESCE($40::date, ata_loading_complete),
          eta_discharge_arrival = COALESCE($41::date, eta_discharge_arrival),
          ata_discharge_arrival = COALESCE($42::date, ata_discharge_arrival),
          eta_discharge_start = COALESCE($43::date, eta_discharge_start),
          ata_discharge_start = COALESCE($44::date, ata_discharge_start),
          eta_discharge_complete = COALESCE($45::date, eta_discharge_complete),
          ata_discharge_complete = COALESCE($46::date, ata_discharge_complete),
          sfal_qty = COALESCE($47::numeric, sfal_qty),
          sfbd_qty = COALESCE($48::numeric, sfbd_qty),
          status = CASE
            WHEN $51::boolean IS TRUE
              AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('CANCELLED', 'CANCELED')
              THEN 'COMPLETED'
            WHEN ${sqlShipmentStatusRank('$49::text')} > ${sqlShipmentStatusRank('status')}
            THEN $49
            ELSE status
          END,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $52`,
        [
          contractUuid,
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
          sfalQty,
          sfbdQty,
          statusForInsert,
          contractSapClosed,
          id
        ]
      );
      await ensureMasterVesselFromSap(
        { vessel_code: vesselCode, vessel_name: vesselName, vessel_owner: vesselOwner },
        client,
      );
      if (contractUuid) {
        const reconcile = await finalizeSapShipmentAfterUpsert(
          client,
          contractUuid,
          id,
          shipmentIdFromSap ? String(shipmentIdFromSap).trim() : null,
          contractPoNumber,
        );
        if (reconcile.cancelledShipmentIds.length > 0) {
          logger.info('upsertShipment: cancelled superseded SAP shipment rows', {
            contractId,
            keeperShipmentId: id,
            cancelled: reconcile.cancelledShipmentIds,
          });
        }
      }
      return id;
    } else if (shipmentIdFromSap && contractUuid) {
      let klipProtectShipmentFields = false;
      const existingForConflict = await client.query(
        `SELECT id FROM shipments
         WHERE contract_id = $1::uuid AND shipment_id = $2
         LIMIT 1`,
        [contractUuid, shipmentIdFromSap],
      );
      if (existingForConflict.rows.length > 0) {
        klipProtectShipmentFields = await hasKlipShipmentActivity(
          client,
          existingForConflict.rows[0].id,
          contractUuid ?? undefined,
        );
      }
      const shipmentConflictProtectedSql = buildShipmentKlipProtectedSetSql(
        klipProtectShipmentFields,
        'excluded',
      );
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
          total_lead_time_days, sfal_qty, sfbd_qty
        ) VALUES (
          $1, $2::uuid, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12::int,
          $13, $14, $15, $16, $17, $18::date, $19::date, $20::date, $21::date, $22::date, $23::date,
          $24::numeric, $25::numeric, $26::numeric, $27::numeric, $28::numeric, $29::numeric, $30::numeric,
          $31::numeric, $32::numeric, $33::numeric, $34::date, $35::date, $36::date, $37::date,
          $38::date, $39::date, $40::date, $41::date, $42::date, $43::date, $44::numeric, $45::numeric,
          $46::int, $47::int, $48::int, $49::numeric, $50::numeric
        )
        ON CONFLICT (contract_id, shipment_id) DO UPDATE SET
          voyage_no     = COALESCE(EXCLUDED.voyage_no, shipments.voyage_no),
          ${shipmentConflictProtectedSql},
          vessel_owner  = COALESCE(EXCLUDED.vessel_owner, shipments.vessel_owner),
          vessel_draft  = COALESCE(EXCLUDED.vessel_draft, shipments.vessel_draft),
          vessel_loa    = COALESCE(EXCLUDED.vessel_loa, shipments.vessel_loa),
          vessel_capacity = COALESCE(EXCLUDED.vessel_capacity, shipments.vessel_capacity),
          vessel_hull_type = COALESCE(EXCLUDED.vessel_hull_type, shipments.vessel_hull_type),
          vessel_registration_year = COALESCE(EXCLUDED.vessel_registration_year, shipments.vessel_registration_year),
          charter_type  = COALESCE(EXCLUDED.charter_type, shipments.charter_type),
          loading_method  = COALESCE(EXCLUDED.loading_method, shipments.loading_method),
          discharge_method = COALESCE(EXCLUDED.discharge_method, shipments.discharge_method),
          eta_arrival   = COALESCE(EXCLUDED.eta_arrival, shipments.eta_arrival),
          ata_arrival   = COALESCE(EXCLUDED.ata_arrival, shipments.ata_arrival),
          eta_sailed    = COALESCE(EXCLUDED.eta_sailed, shipments.eta_sailed),
          ata_sailed    = COALESCE(EXCLUDED.ata_sailed, shipments.ata_sailed),
          shipment_date = COALESCE(EXCLUDED.shipment_date, shipments.shipment_date),
          arrival_date  = COALESCE(EXCLUDED.arrival_date, shipments.arrival_date),
          quantity_shipped = COALESCE(EXCLUDED.quantity_shipped, shipments.quantity_shipped),
          bl_quantity   = COALESCE(EXCLUDED.bl_quantity, shipments.bl_quantity),
          difference_final_qty_vs_bl_qty = COALESCE(EXCLUDED.difference_final_qty_vs_bl_qty, shipments.difference_final_qty_vs_bl_qty),
          estimated_km  = COALESCE(EXCLUDED.estimated_km, shipments.estimated_km),
          estimated_nautical_miles = COALESCE(EXCLUDED.estimated_nautical_miles, shipments.estimated_nautical_miles),
          vessel_oa_budget = COALESCE(EXCLUDED.vessel_oa_budget, shipments.vessel_oa_budget),
          vessel_oa_actual = COALESCE(EXCLUDED.vessel_oa_actual, shipments.vessel_oa_actual),
          average_vessel_speed = COALESCE(EXCLUDED.average_vessel_speed, shipments.average_vessel_speed),
          eta_loading_start = COALESCE(EXCLUDED.eta_loading_start, shipments.eta_loading_start),
          ata_loading_start = COALESCE(EXCLUDED.ata_loading_start, shipments.ata_loading_start),
          eta_loading_complete = COALESCE(EXCLUDED.eta_loading_complete, shipments.eta_loading_complete),
          ata_loading_complete = COALESCE(EXCLUDED.ata_loading_complete, shipments.ata_loading_complete),
          eta_discharge_arrival = COALESCE(EXCLUDED.eta_discharge_arrival, shipments.eta_discharge_arrival),
          ata_discharge_arrival = COALESCE(EXCLUDED.ata_discharge_arrival, shipments.ata_discharge_arrival),
          eta_discharge_start = COALESCE(EXCLUDED.eta_discharge_start, shipments.eta_discharge_start),
          ata_discharge_start = COALESCE(EXCLUDED.ata_discharge_start, shipments.ata_discharge_start),
          eta_discharge_complete = COALESCE(EXCLUDED.eta_discharge_complete, shipments.eta_discharge_complete),
          ata_discharge_complete = COALESCE(EXCLUDED.ata_discharge_complete, shipments.ata_discharge_complete),
          loading_rate  = COALESCE(EXCLUDED.loading_rate, shipments.loading_rate),
          discharge_rate = COALESCE(EXCLUDED.discharge_rate, shipments.discharge_rate),
          loading_duration_days = COALESCE(EXCLUDED.loading_duration_days, shipments.loading_duration_days),
          discharge_duration_days = COALESCE(EXCLUDED.discharge_duration_days, shipments.discharge_duration_days),
          total_lead_time_days = COALESCE(EXCLUDED.total_lead_time_days, shipments.total_lead_time_days),
          sfal_qty = COALESCE(EXCLUDED.sfal_qty, shipments.sfal_qty),
          sfbd_qty = COALESCE(EXCLUDED.sfbd_qty, shipments.sfbd_qty),
          status = CASE
            WHEN $51::boolean IS TRUE
              AND UPPER(TRIM(COALESCE(shipments.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
              THEN 'COMPLETED'
            WHEN ${sqlShipmentStatusRank('EXCLUDED.status')} > ${sqlShipmentStatusRank('shipments.status')}
            THEN EXCLUDED.status
            ELSE shipments.status
          END,
          updated_at    = CURRENT_TIMESTAMP
        RETURNING id`,
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
          totalLeadTimeDays,
          sfalQty,
          sfbdQty,
          contractSapClosed,
        ]
      );
      await ensureMasterVesselFromSap(
        { vessel_code: vesselCode, vessel_name: vesselName, vessel_owner: vesselOwner },
        client,
      );
      const newId = result.rows[0].id as string;
      if (contractUuid) {
        const reconcile = await finalizeSapShipmentAfterUpsert(
          client,
          contractUuid,
          newId,
          shipmentIdFromSap ? String(shipmentIdFromSap).trim() : null,
          contractPoNumber,
        );
        if (reconcile.cancelledShipmentIds.length > 0) {
          logger.info('upsertShipment: cancelled superseded SAP shipment rows after insert', {
            contractId,
            keeperShipmentId: newId,
            cancelled: reconcile.cancelledShipmentIds,
          });
        }
      }
      return newId;
    }

    // If we reach here, we had neither a direct shipment_id nor a good vessel-name match.
    // Safely skip creating a shipment for this row.
    logger.warn('No suitable shipment target found for SAP row; skipping shipment upsert', {
      shipmentIdFromSap,
      contractId,
      vesselName
    });
    return null;
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
    await upsertVesselLoadingPortsFromSapData(client, shipmentId, parsedData ?? {});
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
   * SAP upload uses "Trucking Start/Last Receive Date" (columns AV/AW), not
   * trucking_completion_date_at_starting_location. Resolve DB dates from all aliases.
   */
  private static firstParsedDate(...values: unknown[]): string | null {
    for (const v of values) {
      const d = this.parseDate(v);
      if (d) return d;
    }
    return null;
  }

  private static resolveTruckingStartDate(data: Record<string, unknown>): string | null {
    return this.firstParsedDate(
      data.trucking_starting_date_at_starting_location,
      data.trucking_starting_date_at_starting_location_2,
      data.trucking_starting_date_at_starting_location_3,
      data.trucking_start_receive_date
    );
  }

  private static resolveTruckingCompletionDate(data: Record<string, unknown>): string | null {
    return this.firstParsedDate(
      data.trucking_completion_date_at_starting_location,
      data.trucking_completion_date_at_starting_location_2,
      data.trucking_completion_date_at_starting_location_3,
      data.trucking_last_receive_date,
      data.last_receive_date
    );
  }

  private static deriveTruckingStatusForSap(
    startDate: string | null,
    completionDate: string | null,
    contractClosed = false,
  ): 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' {
    if (completionDate || contractClosed) return 'COMPLETED';
    if (startDate) return 'IN_PROGRESS';
    return 'PLANNED';
  }

  private static async isContractSapClosedForUuid(
    client: PoolClient,
    contractUuid: string | null,
    stoKey?: string | null,
  ): Promise<boolean> {
    if (!contractUuid) return false;
    const sto = stoKey != null ? String(stoKey).trim() : '';
    if (sto) {
      const result = await client.query(
        `SELECT ${sqlContractImportStatusForStoExpr('c', 'q.sto_key')} AS import_status
         FROM contracts c
         CROSS JOIN (SELECT $2::text AS sto_key) q
         WHERE c.id = $1::uuid
         LIMIT 1`,
        [contractUuid, sto],
      );
      return isContractDeliveryClosed(result.rows[0]?.import_status);
    }
    const result = await client.query(
      `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status FROM contracts c WHERE c.id = $1 LIMIT 1`,
      [contractUuid],
    );
    return isContractDeliveryClosed(result.rows[0]?.import_status);
  }

  /** Copy SAP raw AV/AW columns into trucking leg when normalized trucking[] dates are missing. */
  private static enrichLandTruckingDataFromRaw(parsedData: any, truckingData: any): { sequence: number; data: Record<string, unknown> } {
    const data: Record<string, unknown> = { ...(truckingData?.data || {}) };
    const raw = parsedData?.raw || {};
    const pick = (keys: string[]): unknown => {
      for (const k of keys) {
        const v = raw[k];
        if (v != null && String(v).trim() !== '') return v;
      }
      return null;
    };
    if (!data.trucking_start_receive_date) {
      data.trucking_start_receive_date = pick([
        'Trucking Start Receive Date',
        'trucking start receive date',
      ]);
    }
    if (!data.trucking_last_receive_date) {
      data.trucking_last_receive_date = pick([
        'Trucking Last Receive Date',
        'trucking last receive date',
      ]);
    }
    if (!data.quantity_delivered_via_trucking) {
      data.quantity_delivered_via_trucking = resolveSapTruckingQuantityDelivered(parsedData);
    }
    return { sequence: truckingData?.sequence ?? 1, data };
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

    if (contractUuid) {
      const incRes = await client.query(
        `SELECT
           c.incoterm,
           (
             SELECT COALESCE(
               spd.data->'contract'->>'incoterm',
               spd.data->'raw'->>'Incoterm',
               spd.data->>'Incoterm'
             )
             FROM sap_processed_data spd
             WHERE TRIM(spd.contract_number) = TRIM(c.contract_id::text)
             ORDER BY spd.created_at DESC NULLS LAST
             LIMIT 1
           ) AS sap_incoterm
         FROM contracts c
         WHERE c.id = $1
         LIMIT 1`,
        [contractUuid]
      );
      const incoterm = resolveTruckingIncotermFromParsedData(
        null,
        incRes.rows[0]?.incoterm ?? incRes.rows[0]?.sap_incoterm,
      );
      if (!isTruckingPageIncoterm(incoterm)) {
        logger.warn('Skipping trucking upsert: contract incoterm is not FRC/LCO', {
          contractUuid,
          incoterm,
        });
        return null;
      }
    }
    
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
    
    const startDate = this.resolveTruckingStartDate(data);
    const completionDate = this.resolveTruckingCompletionDate(data);
    const contractSapClosed = await this.isContractSapClosedForUuid(client, contractUuid);
    const status = this.deriveTruckingStatusForSap(startDate, completionDate, contractSapClosed);

    const truckingOwner = data.trucking_owner_at_starting_location;

    // Reuse existing active trucking row on this contract (never insert duplicate SAP siblings).
    let targetTruckingId: string | null = null;
    if (contractUuid) {
      const existingForContract = await client.query<{ id: string; trucking_owner: string | null }>(
        `SELECT t.id, t.trucking_owner
         FROM trucking_operations t
         WHERE t.contract_id = $1::uuid
           AND COALESCE(t.status, '') <> 'CANCELLED'
         ORDER BY
           CASE WHEN ${sqlHasTruckingKlipPlanning('t')} THEN 0 ELSE 1 END,
           ${SQL_TRUCKING_KEEPER_PRIORITY_ORDER}`,
        [contractUuid],
      );

      if (existingForContract.rows.length > 0) {
        const keeperRow = existingForContract.rows[0]!;
        if (truckingOwner) {
          let bestId = keeperRow.id;
          let bestScore = 0;
          for (const row of existingForContract.rows) {
            const score = this.stringSimilarity(truckingOwner, row.trucking_owner);
            if (score > bestScore) {
              bestScore = score;
              bestId = row.id;
            }
          }
          targetTruckingId = bestScore >= 0.8 ? bestId : keeperRow.id;
        } else {
          targetTruckingId = keeperRow.id;
        }
      }
    }

    if (targetTruckingId) {
      const klipProtectTruckingFields = await hasKlipTruckingActivity(client, targetTruckingId);
      const truckingProtectedSql = buildTruckingKlipProtectedSetSql(klipProtectTruckingFields);
      // Update existing trucking operation, but do NOT override:
      // - eta_delivery_start_date, eta_delivery_end_date
      // - eta_trucking_start_date, eta_trucking_completion_date
      // KLIP-protected when row has user activity: loading/unloading location, qty delivered.
      // Status is re-derived from SAP start/last receive when not CANCELLED.
      await client.query(
        `UPDATE trucking_operations SET
          shipment_id = COALESCE(NULLIF($1::text, '')::uuid, shipment_id),
          location_sequence = COALESCE($2, location_sequence),
          cargo_readiness_date = COALESCE($3::date, cargo_readiness_date),
          ${truckingProtectedSql},
          location = COALESCE($6, location),
          trucking_owner = COALESCE($7, trucking_owner),
          oa_budget = COALESCE($8::numeric, oa_budget),
          oa_actual = COALESCE($9::numeric, oa_actual),
          quantity_sent = COALESCE($10::numeric, quantity_sent),
          gain_loss = COALESCE($12::numeric, gain_loss),
          status = CASE
            WHEN status = 'CANCELLED' THEN status
            WHEN $14::date IS NOT NULL THEN 'COMPLETED'
            WHEN $13::date IS NOT NULL THEN 'IN_PROGRESS'
            ELSE COALESCE(status, 'PLANNED')
          END,
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
      if (startDate || completionDate) {
        await upsertTruckingRealization(client, targetTruckingId, {
          realizationStartDate: startDate,
          realizationEndDate: completionDate,
          source: 'sap',
          markSapSynced: true,
        });
      }
      if (contractUuid) {
        await finalizeSapTruckingAfterUpsert(client, contractUuid, targetTruckingId);
      }
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
        NULL, NULL, $14
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
        status
      ]
    );
    const newTruckingId = result.rows[0].id as string;
    if (startDate || completionDate) {
      await upsertTruckingRealization(client, newTruckingId, {
        realizationStartDate: startDate,
        realizationEndDate: completionDate,
        source: 'sap',
        markSapSynced: true,
      });
    }

    if (contractUuid) {
      await finalizeSapTruckingAfterUpsert(client, contractUuid, newTruckingId);
    }
    return newTruckingId;
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
  private static hasContractData(contractData: any, _parsedData?: any): boolean {
    if (!contractData) return false;
    return !!normalizePoNumber(contractData.po_no);
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
  /** Copy SFAL/SFBD from SAP raw row when normalized shipment object missed them. */
  private static enrichShipmentSfalSfbdFromRaw(shipmentData: Record<string, unknown>, raw: Record<string, unknown> | undefined): void {
    if (!shipmentData || !raw) return;
    if (shipmentData.sfal == null && shipmentData.sfal_qty == null) {
      const sfal = raw[' Ship Figure After Loading (SFAL) ']
        ?? raw['Ship Figure After Loading (SFAL)']
        ?? null;
      if (sfal != null && String(sfal).trim() !== '') {
        shipmentData.sfal = sfal;
      }
    }
    if (shipmentData.sfbd == null && shipmentData.sfbd_qty == null) {
      const sfbd = raw[' Ship Figure Before Discharge (SFBD) ']
        ?? raw['Ship Figure Before Discharge (SFBD)']
        ?? null;
      if (sfbd != null && String(sfbd).trim() !== '') {
        shipmentData.sfbd = sfbd;
      }
    }
  }

  /** SAP figure quantities are stored in Kg (same unit as Quantity Delivery / Receive). */
  private static parseSapFigureQtyKg(...values: unknown[]): number | null {
    for (const value of values) {
      const kg = this.parseNumber(value);
      if (kg !== null) return kg;
    }
    return null;
  }

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

