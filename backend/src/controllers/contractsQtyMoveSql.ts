/**
 * SAP quantity movement per contract for outstanding qty.
 * @see contractGlobalOutstandingSql.ts — shared implementation.
 */
export {
  CONTRACTS_QTY_MOVE_CTE,
  buildQtyMoveCte,
  sqlContractGlobalOutstandingExpr,
} from '../utils/contractGlobalOutstandingSql';
