export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  if (process.env.NODE_ENV === 'development') {
    // Check if explicitly disabled
    if (process.env.JOB_QUEUE_AUTO_PROCESS === '0') {
      console.warn('[job-queue] Auto processor explicitly disabled.')
      return
    }
  } else {
    // In production/other envs, require explicit enable
    if (process.env.JOB_QUEUE_AUTO_PROCESS !== '1') {
      return
    }
  }

  // Start the job processor
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { jobQueue } = await import('@/lib/unified-job-queue');

      if (process.env.NODE_ENV === 'development') {
        console.log('[job-queue] Starting development job processor...');
      }

      // Process jobs every 10 seconds
      setInterval(async () => {
        try {
          await jobQueue.processJobs(10);
        } catch (error) {
          console.error('[job-queue] Failed to process jobs:', error);
        }
      }, 10000);
    } catch (error) {
      console.error('[job-queue] Failed to initialize job queue:', error);
    }
  }
}
