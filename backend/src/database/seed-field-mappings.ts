import pool from './connection';
import logger from '../utils/logger';

interface FieldMapping {
  sapFieldName: string;
  displayName: string;
  fieldType: string;
  userRole: string;
  isRequired: boolean;
  isEditable: boolean;
  sapSource?: string;
  colorCode?: string;
  sortOrder: number;
}

/**
 * Comprehensive field mappings for SAP MASTER v2
 * Based on analysis of "Logistics Overview 13.10.2025 (Logic) - from IT.xlsx"
 */
const FIELD_MAPPINGS: FieldMapping[] = [
  // TRADING TEAM FIELDS
  { sapFieldName: 'Group', displayName: 'Group', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'LFA1-KONZS', colorCode: '#FFA500', sortOrder: 1 },
  { sapFieldName: 'Supplier', displayName: 'Supplier', fieldType: 'text', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'LFA1-NAME1', colorCode: '#FFA500', sortOrder: 2 },
  { sapFieldName: 'Contract_Date', displayName: 'Contract Date', fieldType: 'date', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKKO-BEDAT', colorCode: '#FFA500', sortOrder: 3 },
  { sapFieldName: 'Product', displayName: 'Product', fieldType: 'text', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'ZTCONF_COMM_MAT-MATNR', colorCode: '#FFA500', sortOrder: 4 },
  { sapFieldName: 'Contract_Number', displayName: 'Contract Number', fieldType: 'text', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKPO-KONNR', colorCode: '#FFA500', sortOrder: 5 },
  { sapFieldName: 'PO_Number', displayName: 'PO Number', fieldType: 'text', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKPO-EBELN', colorCode: '#FFA500', sortOrder: 6 },
  { sapFieldName: 'Incoterm', displayName: 'Incoterm', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'EKKO-INCO1', colorCode: '#FFA500', sortOrder: 7 },
  { sapFieldName: 'Sea_Land', displayName: 'Sea / Land', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'ZNEGO-TRANSPORT', colorCode: '#FFA500', sortOrder: 8 },
  { sapFieldName: 'Contract_Quantity', displayName: 'Contract Quantity', fieldType: 'number', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKPO-MENGE', colorCode: '#FFA500', sortOrder: 9 },
  { sapFieldName: 'Unit_Price', displayName: 'Unit Price', fieldType: 'number', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKPO-NETPR', colorCode: '#FFA500', sortOrder: 10 },
  { sapFieldName: 'Due_Date_Delivery_Start', displayName: 'Due Date Delivery (Start)', fieldType: 'date', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'ZNEGO-BEG_DATE', colorCode: '#FFA500', sortOrder: 11 },
  { sapFieldName: 'Due_Date_Delivery_End', displayName: 'Due Date Delivery (End)', fieldType: 'date', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'ZNEGO-END_DATE', colorCode: '#FFA500', sortOrder: 12 },
  { sapFieldName: 'Source_Type', displayName: 'Source (3rd Party/Inhouse)', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'EKKO-LIFNR', colorCode: '#FFA500', sortOrder: 13 },
  { sapFieldName: 'Contract_Type', displayName: 'LTC / Spot', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: false, sapSource: 'ZNEGO-BUY_COND', colorCode: '#FFA500', sortOrder: 14 },
  { sapFieldName: 'Status', displayName: 'Status', fieldType: 'text', userRole: 'TRADING', isRequired: true, isEditable: false, sapSource: 'EKPO-ELIKZ', colorCode: '#FFA500', sortOrder: 15 },
  
  // LOGISTICS TRUCKING TEAM FIELDS
  { sapFieldName: 'STO_Number', displayName: 'STO No.', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, sapSource: 'EKPO-EBELN', colorCode: '#00FF00', sortOrder: 1 },
  { sapFieldName: 'STO_Quantity', displayName: 'STO Quantity', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, sapSource: 'EKPO-MENGE', colorCode: '#00FF00', sortOrder: 2 },
  { sapFieldName: 'Logistics_Classification', displayName: 'Logistics Area Classification', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 3 },
  { sapFieldName: 'PO_Classification', displayName: 'PO Classification', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, sapSource: 'ZNEGO', colorCode: '#00FF00', sortOrder: 4 },
  { sapFieldName: 'Cargo_Readiness_1', displayName: 'Cargo Readiness at Starting Location', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 5 },
  { sapFieldName: 'Truck_Loading_1', displayName: 'Truck Loading at Starting Location', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 6 },
  { sapFieldName: 'Truck_Unloading_1', displayName: 'Truck Unloading at Starting Location', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 7 },
  { sapFieldName: 'Trucking_Owner_1', displayName: 'Trucking Owner at Starting Location', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, sapSource: 'LFA1-NAME1', colorCode: '#00FF00', sortOrder: 8 },
  { sapFieldName: 'Trucking_OA_Budget_1', displayName: 'Trucking OA Budget at Starting Location', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 9 },
  { sapFieldName: 'Trucking_OA_Actual_1', displayName: 'Trucking OA Actual at Starting Location', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, sapSource: 'PRCD_ELEMENTS-KBETR', colorCode: '#00FF00', sortOrder: 10 },
  { sapFieldName: 'Quantity_Sent_Trucking', displayName: 'Quantity Sent via Trucking', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, sapSource: 'ZWB_TRX-WNETTOKB', colorCode: '#00FF00', sortOrder: 11 },
  { sapFieldName: 'Quantity_Delivered_Trucking', displayName: 'Quantity Delivered via Trucking', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, sapSource: 'ZWB_TRX-WNETTOPB1', colorCode: '#00FF00', sortOrder: 12 },
  { sapFieldName: 'Trucking_Start_Date_1', displayName: 'Trucking Starting Date at Starting Location', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, sapSource: 'ZWB_TRX-WTGLREF', colorCode: '#00FF00', sortOrder: 13 },
  { sapFieldName: 'Trucking_Completion_Date_1', displayName: 'Trucking Completion Date at Starting Location', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, sapSource: 'ZWB_TRX-WTGLREF', colorCode: '#00FF00', sortOrder: 14 },
  
  // LOGISTICS SHIPPING TEAM FIELDS
  { sapFieldName: 'Vessel_Code', displayName: 'Vessel Code', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'EKKO-ZZVESSEL', colorCode: '#0080FF', sortOrder: 1 },
  { sapFieldName: 'Vessel_Name', displayName: 'Vessel Name', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZVESSEL2-VSLNM', colorCode: '#0080FF', sortOrder: 2 },
  { sapFieldName: 'Vessel_Owner', displayName: 'Vessel Owner', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 3 },
  { sapFieldName: 'Vessel_Draft', displayName: 'Vessel Draft', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 4 },
  { sapFieldName: 'Vessel_LOA', displayName: 'Vessel LOA', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 5 },
  { sapFieldName: 'Vessel_Capacity', displayName: 'Vessel Capacity', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 6 },
  { sapFieldName: 'Vessel_Hull_Type', displayName: 'Vessel Hull Type', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 7 },
  { sapFieldName: 'Vessel_Registration_Year', displayName: 'Vessel Registration Year', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 8 },
  { sapFieldName: 'Charter_Type', displayName: 'Charter Type (VC/TC/Mix)', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 9 },
  { sapFieldName: 'Voyage_Number', displayName: 'Voyage No.', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 10 },
  { sapFieldName: 'Loading_Port_1', displayName: 'Vessel Loading Port 1', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZNEGO-INCO2', colorCode: '#0080FF', sortOrder: 11 },
  { sapFieldName: 'Discharge_Port', displayName: 'Vessel Discharge Port', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZNEGO-DESTINATION2', colorCode: '#0080FF', sortOrder: 12 },
  { sapFieldName: 'Loading_Method', displayName: 'Loading Method (Pipeline/Trucking)', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 13 },
  { sapFieldName: 'Discharge_Method', displayName: 'Discharge Method (Pipeline/Trucking)', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 14 },
  { sapFieldName: 'ETA_Arrival_LP1', displayName: 'ETA Vessel Arrival Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-ETA', colorCode: '#0080FF', sortOrder: 15 },
  { sapFieldName: 'ATA_Arrival_LP1', displayName: 'ATA Vessel Arrival Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_ARRV', colorCode: '#0080FF', sortOrder: 16 },
  { sapFieldName: 'ETA_Berthed_LP1', displayName: 'ETA Vessel Berthed Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_BERTH', colorCode: '#0080FF', sortOrder: 17 },
  { sapFieldName: 'ATA_Berthed_LP1', displayName: 'ATA Vessel Berthed Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_BERTHTM', colorCode: '#0080FF', sortOrder: 18 },
  { sapFieldName: 'ETA_Loading_Start_LP1', displayName: 'ETA Loading Start Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_HOSEON', colorCode: '#0080FF', sortOrder: 19 },
  { sapFieldName: 'ATA_Loading_Start_LP1', displayName: 'ATA Loading Start Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_HOSEONT', colorCode: '#0080FF', sortOrder: 20 },
  { sapFieldName: 'ETA_Loading_Complete_LP1', displayName: 'ETA Loading Complete Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_COMP', colorCode: '#0080FF', sortOrder: 21 },
  { sapFieldName: 'ATA_Loading_Complete_LP1', displayName: 'ATA Loading Complete Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_COMPTM', colorCode: '#0080FF', sortOrder: 22 },
  { sapFieldName: 'ETA_Sailed_LP1', displayName: 'ETA Vessel Sailed Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_SAIL', colorCode: '#0080FF', sortOrder: 23 },
  { sapFieldName: 'ATA_Sailed_LP1', displayName: 'ATA Vessel Sailed Loading Port 1', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-VSL_SAILTM', colorCode: '#0080FF', sortOrder: 24 },
  { sapFieldName: 'Loading_Rate_LP1', displayName: 'Loading Rate Loading Port 1', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 25 },
  
  // FINANCE TEAM FIELDS
  { sapFieldName: 'Due_Date_Payment', displayName: 'Due Date Payment', fieldType: 'date', userRole: 'FINANCE', isRequired: false, isEditable: false, sapSource: 'ZPO_ADDI-ESTPAYDATE', colorCode: '#FFD700', sortOrder: 1 },
  { sapFieldName: 'DP_Date', displayName: 'DP Date', fieldType: 'date', userRole: 'FINANCE', isRequired: false, isEditable: false, sapSource: 'EKBE-BUDAT', colorCode: '#FFD700', sortOrder: 2 },
  { sapFieldName: 'Payoff_Date', displayName: 'Payoff Date', fieldType: 'date', userRole: 'FINANCE', isRequired: false, isEditable: true, colorCode: '#FFD700', sortOrder: 3 },
  { sapFieldName: 'Payment_Deviation', displayName: 'Payment Date Deviation (days)', fieldType: 'number', userRole: 'FINANCE', isRequired: false, isEditable: false, colorCode: '#FFD700', sortOrder: 4 },
  
  // QUALITY TEAM FIELDS - Loading Port 1
  { sapFieldName: 'FFA_LP1', displayName: 'FFA - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-FFA_LP', colorCode: '#FF69B4', sortOrder: 1 },
  { sapFieldName: 'MI_LP1', displayName: 'M&I - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-MNI-LP', colorCode: '#FF69B4', sortOrder: 2 },
  { sapFieldName: 'DOBI_LP1', displayName: 'DOBI - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-DOBI_LP', colorCode: '#FF69B4', sortOrder: 3 },
  { sapFieldName: 'IV_LP1', displayName: 'IV - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-IV_LP', colorCode: '#FF69B4', sortOrder: 4 },
  { sapFieldName: 'Color_Red_LP1', displayName: 'Color-Red - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-RED_LP', colorCode: '#FF69B4', sortOrder: 5 },
  { sapFieldName: 'DS_LP1', displayName: 'D&S - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-DNS_LP', colorCode: '#FF69B4', sortOrder: 6 },
  { sapFieldName: 'Stone_LP1', displayName: 'Stone - Loading Port 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-STONE_LP', colorCode: '#FF69B4', sortOrder: 7 },
  
  // QUALITY TEAM FIELDS - Loading Port 2
  { sapFieldName: 'FFA_LP2', displayName: 'FFA - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 8 },
  { sapFieldName: 'MI_LP2', displayName: 'M&I - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 9 },
  { sapFieldName: 'DOBI_LP2', displayName: 'DOBI - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 10 },
  { sapFieldName: 'IV_LP2', displayName: 'IV - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 11 },
  { sapFieldName: 'Color_Red_LP2', displayName: 'Color-Red - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 12 },
  { sapFieldName: 'DS_LP2', displayName: 'D&S - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 13 },
  { sapFieldName: 'Stone_LP2', displayName: 'Stone - Loading Port 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 14 },
  
  // QUALITY TEAM FIELDS - Loading Port 3
  { sapFieldName: 'FFA_LP3', displayName: 'FFA - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 15 },
  { sapFieldName: 'MI_LP3', displayName: 'M&I - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 16 },
  { sapFieldName: 'DOBI_LP3', displayName: 'DOBI - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 17 },
  { sapFieldName: 'IV_LP3', displayName: 'IV - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 18 },
  { sapFieldName: 'Color_Red_LP3', displayName: 'Color-Red - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 19 },
  { sapFieldName: 'DS_LP3', displayName: 'D&S - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 20 },
  { sapFieldName: 'Stone_LP3', displayName: 'Stone - Loading Port 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 21 },
  
  // QUALITY TEAM FIELDS - Discharge Port
  { sapFieldName: 'FFA_DP', displayName: 'FFA - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-FFA_DP', colorCode: '#FF69B4', sortOrder: 22 },
  { sapFieldName: 'MI_DP', displayName: 'M&I - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-MNI_DP', colorCode: '#FF69B4', sortOrder: 23 },
  { sapFieldName: 'DOBI_DP', displayName: 'DOBI - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-DOBI_DP', colorCode: '#FF69B4', sortOrder: 24 },
  { sapFieldName: 'IV_DP', displayName: 'IV - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-IV_DP', colorCode: '#FF69B4', sortOrder: 25 },
  { sapFieldName: 'Color_Red_DP', displayName: 'Color-Red - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, sapSource: 'ZMM_SLDI-RED_DP', colorCode: '#FF69B4', sortOrder: 26 },
  { sapFieldName: 'DS_DP', displayName: 'D&S - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 27 },
  { sapFieldName: 'Stone_DP', displayName: 'Stone - Discharge Port', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 28 },
  
  // QUALITY TEAM FIELDS - Surveyors
  { sapFieldName: 'Surveyor_Vendor_1', displayName: 'Surveyor Vendor Name 1', fieldType: 'text', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 29 },
  { sapFieldName: 'Surveyor_Charges_1', displayName: 'Surveyor Charges 1', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 30 },
  { sapFieldName: 'Surveyor_Vendor_2', displayName: 'Surveyor Vendor Name 2', fieldType: 'text', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 31 },
  { sapFieldName: 'Surveyor_Charges_2', displayName: 'Surveyor Charges 2', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 32 },
  { sapFieldName: 'Surveyor_Vendor_3', displayName: 'Surveyor Vendor Name 3', fieldType: 'text', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 33 },
  { sapFieldName: 'Surveyor_Charges_3', displayName: 'Surveyor Charges 3', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 34 },
  { sapFieldName: 'Surveyor_Vendor_4', displayName: 'Surveyor Vendor Name 4', fieldType: 'text', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 35 },
  { sapFieldName: 'Surveyor_Charges_4', displayName: 'Surveyor Charges 4', fieldType: 'number', userRole: 'QUALITY', isRequired: false, isEditable: true, colorCode: '#FF69B4', sortOrder: 36 },
  
  // LOGISTICS TRUCKING TEAM - Location 2
  { sapFieldName: 'Cargo_Readiness_2', displayName: 'Cargo Readiness at Starting Location 2', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 15 },
  { sapFieldName: 'Truck_Loading_2', displayName: 'Truck Loading at Starting Location 2', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 16 },
  { sapFieldName: 'Truck_Unloading_2', displayName: 'Truck Unloading at Starting Location 2', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 17 },
  { sapFieldName: 'Trucking_Owner_2', displayName: 'Trucking Owner at Starting Location 2', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 18 },
  { sapFieldName: 'Trucking_OA_Budget_2', displayName: 'Trucking OA Budget at Starting Location 2', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 19 },
  { sapFieldName: 'Trucking_OA_Actual_2', displayName: 'Trucking OA Actual at Starting Location 2', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 20 },
  { sapFieldName: 'Trucking_Start_Date_2', displayName: 'Trucking Starting Date at Starting Location 2', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 21 },
  { sapFieldName: 'Trucking_Completion_Date_2', displayName: 'Trucking Completion Date at Starting Location 2', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 22 },
  
  // LOGISTICS TRUCKING TEAM - Location 3
  { sapFieldName: 'Cargo_Readiness_3', displayName: 'Cargo Readiness at Starting Location 3', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 23 },
  { sapFieldName: 'Truck_Loading_3', displayName: 'Truck Loading at Starting Location 3', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 24 },
  { sapFieldName: 'Truck_Unloading_3', displayName: 'Truck Unloading at Starting Location 3', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 25 },
  { sapFieldName: 'Trucking_Owner_3', displayName: 'Trucking Owner at Starting Location 3', fieldType: 'text', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 26 },
  { sapFieldName: 'Trucking_OA_Budget_3', displayName: 'Trucking OA Budget at Starting Location 3', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 27 },
  { sapFieldName: 'Trucking_OA_Actual_3', displayName: 'Trucking OA Actual at Starting Location 3', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 28 },
  { sapFieldName: 'Trucking_Start_Date_3', displayName: 'Trucking Starting Date at Starting Location 3', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 29 },
  { sapFieldName: 'Trucking_Completion_Date_3', displayName: 'Trucking Completion Date at Starting Location 3', fieldType: 'date', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 30 },
  
  // LOGISTICS TRUCKING TEAM - Additional Fields
  { sapFieldName: 'Quantity_At_Final_Location', displayName: 'Actual Quantity at Final Location', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: true, colorCode: '#00FF00', sortOrder: 31 },
  { sapFieldName: 'Trucking_Gain_Loss', displayName: 'Trucking Gain/Loss at Starting Location', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, colorCode: '#00FF00', sortOrder: 32 },
  { sapFieldName: 'Trucking_Completion_Rate', displayName: 'Trucking Completion Rate (days)', fieldType: 'number', userRole: 'LOGISTICS_TRUCKING', isRequired: false, isEditable: false, colorCode: '#00FF00', sortOrder: 33 },
  
  // LOGISTICS SHIPPING TEAM - Loading Port 2
  { sapFieldName: 'Cargo_Readiness_LP2', displayName: 'Cargo Readiness at Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 26 },
  { sapFieldName: 'Loading_Method_LP2', displayName: 'Loading Method at Loading Port 2', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 27 },
  { sapFieldName: 'Loading_Port_2', displayName: 'Vessel Loading Port 2', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 28 },
  { sapFieldName: 'Quantity_LP2', displayName: 'Quantity at Loading Port 2', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 29 },
  { sapFieldName: 'ETA_Arrival_LP2', displayName: 'ETA Vessel Arrival Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 30 },
  { sapFieldName: 'ATA_Arrival_LP2', displayName: 'ATA Vessel Arrival Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 31 },
  { sapFieldName: 'ETA_Berthed_LP2', displayName: 'ETA Vessel Berthed Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 32 },
  { sapFieldName: 'ATA_Berthed_LP2', displayName: 'ATA Vessel Berthed Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 33 },
  { sapFieldName: 'ETA_Loading_Start_LP2', displayName: 'ETA Loading Start Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 34 },
  { sapFieldName: 'ATA_Loading_Start_LP2', displayName: 'ATA Loading Start Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 35 },
  { sapFieldName: 'ETA_Loading_Complete_LP2', displayName: 'ETA Loading Complete Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 36 },
  { sapFieldName: 'ATA_Loading_Complete_LP2', displayName: 'ATA Loading Complete Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 37 },
  { sapFieldName: 'ETA_Sailed_LP2', displayName: 'ETA Vessel Sailed Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 38 },
  { sapFieldName: 'ATA_Sailed_LP2', displayName: 'ATA Vessel Sailed Loading Port 2', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 39 },
  { sapFieldName: 'Loading_Rate_LP2', displayName: 'Loading Rate Loading Port 2', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 40 },
  
  // LOGISTICS SHIPPING TEAM - Loading Port 3
  { sapFieldName: 'Cargo_Readiness_LP3', displayName: 'Cargo Readiness at Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 41 },
  { sapFieldName: 'Loading_Method_LP3', displayName: 'Loading Method at Loading Port 3', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 42 },
  { sapFieldName: 'Loading_Port_3', displayName: 'Vessel Loading Port 3', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 43 },
  { sapFieldName: 'Quantity_LP3', displayName: 'Quantity at Loading Port 3', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 44 },
  { sapFieldName: 'ETA_Arrival_LP3', displayName: 'ETA Vessel Arrival Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 45 },
  { sapFieldName: 'ATA_Arrival_LP3', displayName: 'ATA Vessel Arrival Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 46 },
  { sapFieldName: 'ETA_Berthed_LP3', displayName: 'ETA Vessel Berthed Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 47 },
  { sapFieldName: 'ATA_Berthed_LP3', displayName: 'ATA Vessel Berthed Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 48 },
  { sapFieldName: 'ETA_Loading_Start_LP3', displayName: 'ETA Loading Start Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 49 },
  { sapFieldName: 'ATA_Loading_Start_LP3', displayName: 'ATA Loading Start Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 50 },
  { sapFieldName: 'ETA_Loading_Complete_LP3', displayName: 'ETA Loading Complete Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 51 },
  { sapFieldName: 'ATA_Loading_Complete_LP3', displayName: 'ATA Loading Complete Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 52 },
  { sapFieldName: 'ETA_Sailed_LP3', displayName: 'ETA Vessel Sailed Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 53 },
  { sapFieldName: 'ATA_Sailed_LP3', displayName: 'ATA Vessel Sailed Loading Port 3', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 54 },
  { sapFieldName: 'Loading_Rate_LP3', displayName: 'Loading Rate Loading Port 3', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 55 },
  
  // LOGISTICS SHIPPING TEAM - Discharge Port
  { sapFieldName: 'ETA_Discharge_Arrival', displayName: 'ETA Vessel Arrival Discharge Port', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 56 },
  { sapFieldName: 'ATA_Discharge_Arrival', displayName: 'ATA Vessel Arrival Discharge Port', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 57 },
  { sapFieldName: 'ETA_Discharge_Berthed', displayName: 'ETA Vessel Berthed Discharge Port', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 58 },
  { sapFieldName: 'ATA_Discharge_Berthed', displayName: 'ATA Vessel Berthed Discharge Port', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 59 },
  { sapFieldName: 'ETA_Discharge_Start', displayName: 'ETA Discharge Start', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 60 },
  { sapFieldName: 'ATA_Discharge_Start', displayName: 'ATA Discharge Start', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 61 },
  { sapFieldName: 'ETA_Discharge_Complete', displayName: 'ETA Discharge Complete', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 62 },
  { sapFieldName: 'ATA_Discharge_Complete', displayName: 'ATA Discharge Complete', fieldType: 'date', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 63 },
  { sapFieldName: 'Discharge_Rate', displayName: 'Discharge Rate', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 64 },
  { sapFieldName: 'Truck_Loading_Discharge', displayName: 'Truck Loading at Discharge Location', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 65 },
  { sapFieldName: 'Truck_Unloading_Discharge', displayName: 'Truck Unloading at Discharge Location', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 66 },
  { sapFieldName: 'Truck_Owner_Discharge', displayName: 'Trucking Owner at Discharge', fieldType: 'text', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 67 },
  { sapFieldName: 'Trucking_OA_Budget_Discharge', displayName: 'Trucking OA Budget at Discharge', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 68 },
  { sapFieldName: 'Trucking_OA_Actual_Discharge', displayName: 'Trucking OA Actual at Discharge', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 69 },
  
  // LOGISTICS SHIPPING TEAM - Vessel Additional Details
  { sapFieldName: 'Vessel_OA_Budget', displayName: 'Vessel OA Budget', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, colorCode: '#0080FF', sortOrder: 70 },
  { sapFieldName: 'Vessel_OA_Actual', displayName: 'Vessel OA Actual', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: true, sapSource: 'PRCD_ELEMENTS-KEBTR', colorCode: '#0080FF', sortOrder: 71 },
  { sapFieldName: 'Estimated_Nautical_Miles', displayName: 'Estimated Nautical Miles', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: false, sapSource: 'ZDIST_MASTER-DISTANCE', colorCode: '#0080FF', sortOrder: 72 },
  { sapFieldName: 'Average_Vessel_Speed', displayName: 'Average Vessel Speed', fieldType: 'number', userRole: 'LOGISTICS_SHIPPING', isRequired: false, isEditable: false, colorCode: '#0080FF', sortOrder: 73 },
  
  // MANAGEMENT & ANALYSIS FIELDS
  { sapFieldName: 'Contract_Completion_Deviation', displayName: 'Contract Completion Deviation (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 1 },
  { sapFieldName: 'Discharging_Duration', displayName: 'Discharging Duration (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 2 },
  { sapFieldName: 'Cargo_Readiness_vs_Due_Date_LP1', displayName: 'Cargo Readiness vs Due Date - LP1 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 3 },
  { sapFieldName: 'Vessel_Arrival_vs_Cargo_LP1', displayName: 'Vessel Arrival vs Cargo Readiness - LP1 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 4 },
  { sapFieldName: 'Berthing_Duration_LP1', displayName: 'Berthing Duration at LP1 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 5 },
  { sapFieldName: 'Loading_Duration_LP1', displayName: 'Loading Duration at LP1 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 6 },
  { sapFieldName: 'Departing_Prep_Duration_LP1', displayName: 'Departing Preparation Duration LP1 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 7 },
  { sapFieldName: 'Cargo_Readiness_vs_Due_Date_LP2', displayName: 'Cargo Readiness vs Due Date - LP2 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 8 },
  { sapFieldName: 'Vessel_Arrival_vs_Cargo_LP2', displayName: 'Vessel Arrival vs Cargo Readiness - LP2 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 9 },
  { sapFieldName: 'Berthing_Duration_LP2', displayName: 'Berthing Duration at LP2 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 10 },
  { sapFieldName: 'Loading_Duration_LP2', displayName: 'Loading Duration at LP2 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 11 },
  { sapFieldName: 'Departing_Prep_Duration_LP2', displayName: 'Departing Preparation Duration LP2 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 12 },
  { sapFieldName: 'Cargo_Readiness_vs_Due_Date_LP3', displayName: 'Cargo Readiness vs Due Date - LP3 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 13 },
  { sapFieldName: 'Vessel_Arrival_vs_Cargo_LP3', displayName: 'Vessel Arrival vs Cargo Readiness - LP3 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 14 },
  { sapFieldName: 'Berthing_Duration_LP3', displayName: 'Berthing Duration at LP3 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 15 },
  { sapFieldName: 'Loading_Duration_LP3', displayName: 'Loading Duration at LP3 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 16 },
  { sapFieldName: 'Departing_Prep_Duration_LP3', displayName: 'Departing Preparation Duration LP3 (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 17 },
  { sapFieldName: 'Shipping_Duration', displayName: 'Shipping Duration (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 18 },
  { sapFieldName: 'Berthing_Discharge_Duration', displayName: 'Berthing at Discharge Port Duration (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 19 },
  { sapFieldName: 'Discharge_Duration', displayName: 'Discharge Duration (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 20 },
  { sapFieldName: 'Total_Lead_Time', displayName: 'Total Lead Time - Vessel Arrival to Complete Discharge (days)', fieldType: 'number', userRole: 'MANAGEMENT', isRequired: false, isEditable: false, colorCode: '#800080', sortOrder: 21 },
  
  // ADDITIONAL TRADING FIELDS
  { sapFieldName: 'Incoterm_Starting_1', displayName: 'Incoterm at Starting Point 1', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: true, colorCode: '#FFA500', sortOrder: 16 },
  { sapFieldName: 'Incoterm_Starting_2', displayName: 'Incoterm at Starting Point 2', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: true, colorCode: '#FFA500', sortOrder: 17 },
  { sapFieldName: 'Incoterm_Starting_3', displayName: 'Incoterm at Starting Point 3', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: true, colorCode: '#FFA500', sortOrder: 18 },
  { sapFieldName: 'Incoterm_Loading_2', displayName: 'Incoterm at Loading Port 2', fieldType: 'text', userRole: 'TRADING', isRequired: false, isEditable: true, colorCode: '#FFA500', sortOrder: 19 },
];

/**
 * Seed field mappings into database
 */
export async function seedFieldMappings(): Promise<void> {
  const client = await pool.connect();
  
  try {
    logger.info('Starting field mappings seed...');
    
    await client.query('BEGIN');
    
    // Clear existing mappings
    await client.query('DELETE FROM sap_field_mappings');
    logger.info('Cleared existing field mappings');
    
    // Insert new mappings
    for (const mapping of FIELD_MAPPINGS) {
      await client.query(
        `INSERT INTO sap_field_mappings 
         (sap_field_name, display_name, field_type, user_role, is_required, is_editable, color_code, sort_order) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          mapping.sapFieldName,
          mapping.displayName,
          mapping.fieldType,
          mapping.userRole,
          mapping.isRequired,
          mapping.isEditable,
          mapping.colorCode,
          mapping.sortOrder
        ]
      );
    }
    
    await client.query('COMMIT');
    
    logger.info(`✅ Successfully seeded ${FIELD_MAPPINGS.length} field mappings`);
    
    // Log summary by role
    const summary: { [key: string]: number } = {};
    FIELD_MAPPINGS.forEach(m => {
      summary[m.userRole] = (summary[m.userRole] || 0) + 1;
    });
    
    logger.info('Field mappings by role:');
    Object.entries(summary).forEach(([role, count]) => {
      logger.info(`  ${role}: ${count} fields`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to seed field mappings:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  seedFieldMappings()
    .then(() => {
      logger.info('Field mappings seed completed');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Field mappings seed failed:', error);
      process.exit(1);
    });
}

