import { logger } from './logger'

export interface RetryOptions {
  maxAttempts?: number
  delay?: number
  backoff?: 'linear' | 'exponential'
  factor?: number
  maxDelay?: number
  onRetry?: (error: Error, attempt: number) => void
  retryIf?: (error: Error) => boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delay: 1000,
  backoff: 'exponential',
  factor: 2,
  maxDelay: 30000,
  onRetry: () => {},
  retryIf: () => true
}

/**
 * Retry a function with configurable backoff strategy
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      // Check if we should retry
      if (!opts.retryIf(lastError)) {
        throw lastError
      }
      
      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        throw lastError
      }
      
      // Calculate delay
      let delay = opts.delay
      if (opts.backoff === 'exponential') {
        delay = Math.min(
          opts.delay * Math.pow(opts.factor, attempt - 1),
          opts.maxDelay
        )
      }
      
      // Log retry attempt
      logger.warn(`Retry attempt ${attempt}/${opts.maxAttempts}`, {
        error: lastError,
        metadata: { delay, operation: fn.name || 'anonymous' }
      })
      
      // Call onRetry callback
      opts.onRetry(lastError, attempt)
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}

/**
 * Retry decorator for class methods
 */
export function Retryable(options: RetryOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    
    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options)
    }
    
    return descriptor
  }
}

/**
 * Common retry configurations
 */
export const RetryConfigs = {
  // For database operations
  database: {
    maxAttempts: 3,
    delay: 100,
    backoff: 'exponential' as const,
    factor: 2,
    retryIf: (error: Error) => {
      // Retry on connection errors or deadlocks
      const message = error.message.toLowerCase()
      return message.includes('connection') ||
             message.includes('deadlock') ||
             message.includes('timeout')
    }
  },
  
  // For external API calls
  api: {
    maxAttempts: 5,
    delay: 1000,
    backoff: 'exponential' as const,
    factor: 2,
    maxDelay: 30000,
    retryIf: (error: any) => {
      // Retry on network errors or 5xx status codes
      if (error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND') {
        return true
      }
      
      // Retry on server errors (5xx) but not client errors (4xx)
      if (error.status && error.status >= 500) {
        return true
      }
      
      return false
    }
  },
  
  // For SMS operations
  sms: {
    maxAttempts: 3,
    delay: 2000,
    backoff: 'exponential' as const,
    factor: 2,
    retryIf: (error: any) => {
      const code = Number(error?.code)
      const status = typeof error?.status === 'number' ? error.status : Number.NaN

      // Don't retry on permanent Twilio failures.
      if (
        code === 21211 || // Invalid phone number
        code === 21610 || // Recipient has opted out
        code === 21614 || // 'To' number is not a valid mobile number
        code === 21612 || // 'To' number is not currently reachable via SMS
        code === 21408 // Permission denied
      ) {
        return false
      }

      // Retry only when Twilio explicitly indicates back-pressure.
      // Avoid retrying ambiguous transport/server failures because the upstream
      // request may have succeeded and retries can duplicate outbound SMS.
      if (
        code === 20429 || // Twilio rate limit
        code === 30001 || // Queue overflow
        status === 429
      ) {
        return true
      }

      // Default deny: unknown Twilio 4xx-style responses should not be retried.
      return false
    }
  },
  
  // For file operations
  file: {
    maxAttempts: 3,
    delay: 500,
    backoff: 'linear' as const,
    retryIf: (error: any) => {
      // Retry on temporary file system errors
      return error.code === 'EBUSY' ||
             error.code === 'EMFILE' ||
             error.code === 'ENFILE'
    }
  }
}

/**
 * Circuit breaker pattern for protecting failing services
 */
export class CircuitBreaker {
  private failures = 0
  private lastFailTime?: number
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailTime! > this.timeout) {
        this.state = 'half-open'
      } else {
        throw new Error('Circuit breaker is open')
      }
    }
    
    try {
      const result = await fn()
      
      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failures = 0
      }
      
      return result
    } catch (error) {
      this.failures++
      this.lastFailTime = Date.now()
      
      if (this.failures >= this.threshold) {
        this.state = 'open'
        logger.error('Circuit breaker opened', {
          error: error as Error,
          metadata: { failures: this.failures }
        })
      }
      
      throw error
    }
  }
  
  reset() {
    this.state = 'closed'
    this.failures = 0
    this.lastFailTime = undefined
  }
}
