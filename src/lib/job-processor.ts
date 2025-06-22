import { JobQueue, JobType } from './job-queue'
import { sendBulkSMSAsync } from '@/app/actions/sms'
import { categorizeHistoricalEvents } from '@/app/actions/event-categories'

export class JobProcessor {
  private jobQueue: JobQueue
  private isProcessing: boolean = false

  constructor() {
    this.jobQueue = new JobQueue()
  }

  async processJobs(): Promise<void> {
    if (this.isProcessing) return

    this.isProcessing = true
    try {
      const job = await this.jobQueue.getNextPendingJob()
      if (!job) {
        this.isProcessing = false
        return
      }

      console.log(`Processing job ${job.id} of type ${job.type}`)

      try {
        const result = await this.processJob(job.type, job.payload)
        await this.jobQueue.updateJobStatus(job.id, 'completed', result)
        console.log(`Job ${job.id} completed successfully`)
      } catch (error) {
        console.error(`Job ${job.id} failed:`, error)
        await this.jobQueue.updateJobStatus(
          job.id, 
          'failed', 
          undefined, 
          error instanceof Error ? error.message : 'Unknown error'
        )
      }

      // Process next job
      setTimeout(() => {
        this.isProcessing = false
        this.processJobs()
      }, 1000)
    } catch (error) {
      console.error('Error in job processor:', error)
      this.isProcessing = false
    }
  }

  private async processJob(type: JobType, payload: any): Promise<any> {
    switch (type) {
      case 'export_employees':
        return await this.processEmployeeExport(payload)
      
      case 'send_bulk_sms':
        return await this.processBulkSMS(payload)
      
      case 'rebuild_category_stats':
        return await this.rebuildCategoryStats(payload)
      
      case 'categorize_historical_events':
        return await this.categorizeHistoricalEvents(payload)
      
      default:
        throw new Error(`Unknown job type: ${type}`)
    }
  }

  private async processEmployeeExport(payload: any): Promise<any> {
    // Note: We'll need to modify the export function to be async
    // For now, return a placeholder
    return { 
      message: 'Employee export job would be processed here',
      employeeCount: payload?.employeeCount || 0
    }
  }

  private async processBulkSMS(payload: any): Promise<any> {
    const { customerIds, message } = payload
    if (!customerIds || !message) {
      throw new Error('Invalid bulk SMS payload')
    }

    // The actual SMS sending is already async
    const result = await sendBulkSMSAsync(customerIds, message)
    return result
  }

  private async rebuildCategoryStats(payload: any): Promise<any> {
    // This will process the stats rebuild
    return {
      message: 'Category stats rebuild would be processed here',
      categoriesProcessed: 0
    }
  }

  private async categorizeHistoricalEvents(payload: any): Promise<any> {
    const { eventIds, categoryId } = payload
    if (!eventIds || !categoryId) {
      throw new Error('Invalid categorize events payload')
    }

    return {
      message: 'Historical events categorization would be processed here',
      eventsProcessed: eventIds.length
    }
  }
}