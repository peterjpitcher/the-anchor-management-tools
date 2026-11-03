import type { TrainingActionResult } from '@/lib/training/types'

const NO_PERMISSION = 'You do not have permission to do this.'

/**
 * Calls a training server action from the browser and always settles to a result. A permission
 * failure throws on the server (as it does across the app) and reaches the browser as a rejected
 * promise, so it is turned into a plain message here rather than left to crash the screen.
 */
export async function runTrainingAction<T>(
  call: () => Promise<TrainingActionResult<T>>,
  fallback: string,
): Promise<TrainingActionResult<T>> {
  try {
    const result = await call()
    return result ?? { error: fallback }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/insufficient permissions|unauthori[sz]ed/i.test(message)) return { error: NO_PERMISSION }
    return { error: fallback }
  }
}
