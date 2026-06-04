import { query } from '../database/connection'
import logger from '../utils/logger'

export class FinanceMaterializedViewService {
  private static getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  static async refreshContractPaymentDates(): Promise<void> {
    try {
      // Prefer CONCURRENTLY to avoid blocking reads (requires unique index, provided by migration).
      await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_contract_payment_dates`)
      logger.info('Finance MV refreshed: mv_contract_payment_dates')
    } catch (err: unknown) {
      // If concurrently fails (e.g. first time / permissions), fall back to non-concurrent refresh.
      try {
        await query(`REFRESH MATERIALIZED VIEW mv_contract_payment_dates`)
        logger.info('Finance MV refreshed (non-concurrent): mv_contract_payment_dates')
      } catch (err2: unknown) {
        logger.warn('Finance MV refresh failed', { error: this.getErrorMessage(err2) })
      }
    }
  }
}

