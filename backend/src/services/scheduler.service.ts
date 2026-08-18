import * as cron from 'node-cron';
import { ExcelImportService } from './excelImport.service';
import logger from '../utils/logger';
import { FinanceMaterializedViewService } from './financeMaterializedView.service';
import { PipelineDailySummaryService } from './pipelineDailySummary.service';
import { runContractEtaReminderJob } from './contractEtaReminder.service';

export interface ScheduledImport {
  id: string;
  name: string;
  schedule: string;
  isActive: boolean;
  lastRun?: Date;
  nextRun?: Date;
  config: any;
}

export class SchedulerService {
  private static tasks: Map<string, cron.ScheduledTask> = new Map();
  private static scheduledImports: ScheduledImport[] = [];
  
  /**
   * Initialize the scheduler service
   */
  static initialize(): void {
    logger.info('Initializing scheduler service...');
    
    // Create default scheduled imports for Logistics Overview
    this.createDefaultSchedules();
    
    // Start all active schedules
    this.startAllSchedules();

    // Independent cron (not part of the Excel-import ScheduledImport framework/admin UI).
    this.startContractEtaReminderCron();

    logger.info('Scheduler service initialized successfully');
  }

  /**
   * Daily email to Logistics users (above Staff level) listing open contracts missing ETA
   * near their Cargo Readiness Date. Configurable via CONTRACT_ETA_REMINDER_ENABLED /
   * CONTRACT_ETA_REMINDER_CRON; defaults to 07:00 Asia/Jakarta.
   */
  private static startContractEtaReminderCron(): void {
    if (String(process.env.CONTRACT_ETA_REMINDER_ENABLED ?? 'true').toLowerCase() === 'false') {
      logger.info('Contract ETA reminder cron is disabled (CONTRACT_ETA_REMINDER_ENABLED=false)');
      return;
    }
    const schedule = process.env.CONTRACT_ETA_REMINDER_CRON || '0 7 * * *';
    cron.schedule(
      schedule,
      async () => {
        await runContractEtaReminderJob();
      },
      { timezone: 'Asia/Jakarta' },
    );
    logger.info(`Contract ETA reminder cron scheduled: ${schedule} (Asia/Jakarta)`);
  }
  
  /**
   * Create default scheduled imports
   */
  private static createDefaultSchedules(): void {
    const defaultSchedules: Omit<ScheduledImport, 'id'>[] = [
      {
        name: 'Logistics Overview - Morning Import',
        schedule: '0 8 * * *', // 8:00 AM JKT time (UTC+7)
        isActive: true,
        config: {
          type: 'logistics_overview',
          description: 'Daily morning import of Logistics Overview data'
        }
      },
      {
        name: 'Logistics Overview - Afternoon Import',
        schedule: '0 13 * * *', // 1:00 PM JKT time (UTC+7)
        isActive: true,
        config: {
          type: 'logistics_overview',
          description: 'Daily afternoon import of Logistics Overview data'
        }
      },
      {
        name: 'Logistics Overview - Evening Import',
        schedule: '0 17 * * *', // 5:00 PM JKT time (UTC+7)
        isActive: true,
        config: {
          type: 'logistics_overview',
          description: 'Daily evening import of Logistics Overview data'
        }
      },
      {
        name: 'Pipeline Daily Summary Refresh',
        schedule: '0 6 * * *', // 6:00 AM JKT — pre-aggregate Trucking + Shipments pipeline cards
        isActive: true,
        config: {
          type: 'pipeline_daily_summary',
          description: 'Refresh trucking/shipment pipeline daily summary tables'
        }
      },
      {
        name: 'Pre-Planned Groups Nightly Rebuild',
        schedule: '30 6 * * *', // 6:30 AM JKT — after pipeline snapshots
        isActive: true,
        config: {
          type: 'pre_planned_rebuild',
          description: 'Recompute suggested vessel groups for Unplanned contracts'
        }
      }
    ];
    
    defaultSchedules.forEach(schedule => {
      const id = this.generateId();
      this.scheduledImports.push({
        id,
        ...schedule
      });
    });
  }
  
  /**
   * Start all active schedules
   */
  private static startAllSchedules(): void {
    this.scheduledImports.forEach(importSchedule => {
      if (importSchedule.isActive) {
        this.startSchedule(importSchedule);
      }
    });
  }
  
  /**
   * Start a specific schedule
   */
  static startSchedule(importSchedule: ScheduledImport): void {
    try {
      // Stop existing task if it exists
      this.stopSchedule(importSchedule.id);
      
      // Create new cron task
      const task = cron.schedule(importSchedule.schedule, async () => {
        await this.executeScheduledImport(importSchedule);
      }, {
        scheduled: false,
        timezone: 'Asia/Jakarta' // JKT timezone
      });
      
      // Store the task
      this.tasks.set(importSchedule.id, task);
      
      // Calculate next run time
      const nextRun = this.calculateNextRun(importSchedule.schedule);
      importSchedule.nextRun = nextRun;
      
      // Start the task
      task.start();
      
      logger.info(`Started schedule: ${importSchedule.name}`, {
        scheduleId: importSchedule.id,
        schedule: importSchedule.schedule,
        nextRun: nextRun?.toISOString()
      });
      
    } catch (error) {
      logger.error(`Failed to start schedule: ${importSchedule.name}`, error);
    }
  }
  
  /**
   * Stop a specific schedule
   */
  static stopSchedule(scheduleId: string): void {
    const task = this.tasks.get(scheduleId);
    if (task) {
      task.stop();
      this.tasks.delete(scheduleId);
      
      const importSchedule = this.scheduledImports.find(s => s.id === scheduleId);
      if (importSchedule) {
        importSchedule.nextRun = undefined;
        logger.info(`Stopped schedule: ${importSchedule.name}`);
      }
    }
  }
  
  /**
   * Execute a scheduled import
   */
  private static async executeScheduledImport(importSchedule: ScheduledImport): Promise<void> {
    const startTime = new Date();
    
    try {
      logger.info(`Executing scheduled import: ${importSchedule.name}`, {
        scheduleId: importSchedule.id,
        startTime: startTime.toISOString()
      });
      
      let result;
      
      switch (importSchedule.config.type) {
        case 'logistics_overview':
          result = await ExcelImportService.importLogisticsOverview();
          break;
        case 'pipeline_daily_summary':
          await PipelineDailySummaryService.refreshAll();
          await import('./contractQtyMoveSnapshot.service').then(({ ContractQtyMoveSnapshotService }) =>
            ContractQtyMoveSnapshotService.refreshAll(),
          );
          await import('./contractStoAggSnapshot.service').then(({ ContractStoAggSnapshotService }) =>
            ContractStoAggSnapshotService.refreshAll(),
          );
          await import('./contractLatestSpdSnapshot.service').then(({ ContractLatestSpdSnapshotService }) =>
            ContractLatestSpdSnapshotService.refreshAll(),
          );
          await import('./b2bEndingChildSnapshot.service').then(({ B2bEndingChildSnapshotService }) =>
            B2bEndingChildSnapshotService.refreshAll(),
          );
          result = { success: true, totalRecords: 0, processedRecords: 0, failedRecords: 0 };
          break;
        case 'pre_planned_rebuild':
          await import('./prePlannedGroup.service').then(({ rebuildPrePlannedGroups }) =>
            rebuildPrePlannedGroups('nightly-cron'),
          );
          result = { success: true, totalRecords: 0, processedRecords: 0, failedRecords: 0 };
          break;
        default:
          throw new Error(`Unknown import type: ${importSchedule.config.type}`);
      }
      
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      // Update last run time
      importSchedule.lastRun = startTime;
      
      // Calculate next run time
      importSchedule.nextRun = this.calculateNextRun(importSchedule.schedule);
      
      logger.info(`Scheduled import completed: ${importSchedule.name}`, {
        scheduleId: importSchedule.id,
        duration: `${duration}ms`,
        result: {
          success: result.success,
          totalRecords: result.totalRecords,
          processedRecords: result.processedRecords,
          failedRecords: result.failedRecords
        }
      });

      // Keep finance MV in sync with new SAP rows without blocking the scheduler.
      setImmediate(() => {
        FinanceMaterializedViewService.refreshContractPaymentDates().catch(() => {});
        PipelineDailySummaryService.refreshAll().catch(() => {});
        import('./contractQtyMoveSnapshot.service')
          .then(({ ContractQtyMoveSnapshotService }) => ContractQtyMoveSnapshotService.refreshAll())
          .catch(() => {});
        import('./contractStoAggSnapshot.service')
          .then(({ ContractStoAggSnapshotService }) => ContractStoAggSnapshotService.refreshAll())
          .catch(() => {});
        import('./contractLatestSpdSnapshot.service')
          .then(({ ContractLatestSpdSnapshotService }) => ContractLatestSpdSnapshotService.refreshAll())
          .catch(() => {});
        import('./b2bEndingChildSnapshot.service')
          .then(({ B2bEndingChildSnapshotService }) => B2bEndingChildSnapshotService.refreshAll())
          .catch(() => {});
      });
      
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      logger.error(`Scheduled import failed: ${importSchedule.name}`, {
        scheduleId: importSchedule.id,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Update last run time even on failure
      importSchedule.lastRun = startTime;
    }
  }
  
  /**
   * Get all scheduled imports
   */
  static getScheduledImports(): ScheduledImport[] {
    return this.scheduledImports.map(importSchedule => ({
      ...importSchedule,
      nextRun: this.calculateNextRun(importSchedule.schedule)
    }));
  }
  
  /**
   * Get a specific scheduled import
   */
  static getScheduledImport(scheduleId: string): ScheduledImport | undefined {
    const importSchedule = this.scheduledImports.find(s => s.id === scheduleId);
    if (importSchedule) {
      return {
        ...importSchedule,
        nextRun: this.calculateNextRun(importSchedule.schedule)
      };
    }
    return undefined;
  }
  
  /**
   * Update a scheduled import
   */
  static updateScheduledImport(scheduleId: string, updates: Partial<ScheduledImport>): boolean {
    const index = this.scheduledImports.findIndex(s => s.id === scheduleId);
    if (index === -1) {
      return false;
    }
    
    const importSchedule = this.scheduledImports[index];
    const updatedSchedule = { ...importSchedule, ...updates };
    
    // Stop existing task
    this.stopSchedule(scheduleId);
    
    // Update the schedule
    this.scheduledImports[index] = updatedSchedule;
    
    // Start new task if active
    if (updatedSchedule.isActive) {
      this.startSchedule(updatedSchedule);
    }
    
    logger.info(`Updated scheduled import: ${updatedSchedule.name}`, {
      scheduleId,
      updates
    });
    
    return true;
  }
  
  /**
   * Delete a scheduled import
   */
  static deleteScheduledImport(scheduleId: string): boolean {
    const index = this.scheduledImports.findIndex(s => s.id === scheduleId);
    if (index === -1) {
      return false;
    }
    
    const importSchedule = this.scheduledImports[index];
    
    // Stop the task
    this.stopSchedule(scheduleId);
    
    // Remove from array
    this.scheduledImports.splice(index, 1);
    
    logger.info(`Deleted scheduled import: ${importSchedule.name}`, {
      scheduleId
    });
    
    return true;
  }
  
  /**
   * Execute a scheduled import manually
   */
  static async executeScheduledImportManually(scheduleId: string): Promise<any> {
    const importSchedule = this.scheduledImports.find(s => s.id === scheduleId);
    if (!importSchedule) {
      throw new Error(`Scheduled import not found: ${scheduleId}`);
    }
    
    logger.info(`Manually executing scheduled import: ${importSchedule.name}`, {
      scheduleId
    });
    
    await this.executeScheduledImport(importSchedule);
    
    return {
      success: true,
      message: `Scheduled import executed successfully: ${importSchedule.name}`
    };
  }
  
  /**
   * Calculate next run time for a cron expression
   */
  private static calculateNextRun(cronExpression: string): Date | undefined {
    try {
      // This is a simplified calculation - in production, you might want to use a more robust library
      const now = new Date();
      const nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default to next day
      
      // For daily schedules, calculate the next occurrence
      if (cronExpression.includes('* * *')) {
        const parts = cronExpression.split(' ');
        if (parts.length >= 2) {
          const hour = parseInt(parts[1]);
          const minute = parseInt(parts[0]);
          
          if (!isNaN(hour) && !isNaN(minute)) {
            const nextRun = new Date();
            nextRun.setHours(hour, minute, 0, 0);
            
            // If the time has passed today, schedule for tomorrow
            if (nextRun <= now) {
              nextRun.setDate(nextRun.getDate() + 1);
            }
            
            return nextRun;
          }
        }
      }
      
      return nextRun;
    } catch (error) {
      logger.warn('Failed to calculate next run time:', error);
      return undefined;
    }
  }
  
  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Shutdown the scheduler service
   */
  static shutdown(): void {
    logger.info('Shutting down scheduler service...');
    
    // Stop all tasks
    this.tasks.forEach((task, scheduleId) => {
      task.stop();
      logger.info(`Stopped schedule: ${scheduleId}`);
    });
    
    this.tasks.clear();
    logger.info('Scheduler service shutdown complete');
  }
}
