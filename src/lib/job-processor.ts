/**
 * @deprecated Use @/lib/unified-job-queue instead
 * This file is kept for backward compatibility
 */

import { JobQueue } from './job-queue'
import { jobQueue as unifiedJobQueue } from './unified-job-queue'

export class JobProcessor {
  private jobQueue: JobQueue
  private isProcessing: boolean = false

  constructor() {
    console.warn('JobProcessor is deprecated. Use unified-job-queue processJobs() instead.')
    this.jobQueue = new JobQueue()
  }

  async processJobs(): Promise<void> {
    // Redirect to unified job queue
    await unifiedJobQueue.processJobs()
  }
}