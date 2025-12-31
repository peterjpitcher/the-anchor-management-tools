export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  if (process.env.NODE_ENV !== 'development') {
    return
  }

  if (process.env.JOB_QUEUE_AUTO_PROCESS !== '1') {
    return
  }

  console.warn('[job-queue] Auto processor disabled in instrumentation to keep edge builds compatible.')
}
