import { SupabaseClient } from '@supabase/supabase-js'
import { retry, RetryConfigs } from './retry'
import { logger } from './logger'

/**
 * Wraps Supabase operations with retry logic
 */
export function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  return retry(
    operation,
    {
      ...RetryConfigs.database,
      onRetry: (error, attempt) => {
        logger.warn(`Database operation retry: ${operationName}`, {
          error,
          metadata: { attempt, operation: operationName }
        })
      }
    }
  )
}

/**
 * Wrapper for common Supabase operations with retry
 */
export class RetryableSupabase {
  constructor(private supabase: SupabaseClient) {}
  
  async selectWithRetry<T>(
    table: string,
    query: (q: any) => any
  ): Promise<{ data: T[] | null; error: any }> {
    return withRetry(
      async () => {
        const q = this.supabase.from(table).select()
        return await query(q)
      },
      `select from ${table}`
    )
  }
  
  async insertWithRetry<T>(
    table: string,
    data: any
  ): Promise<{ data: T | null; error: any }> {
    return withRetry(
      async () => {
        return await this.supabase
          .from(table)
          .insert(data)
          .select()
          .single()
      },
      `insert into ${table}`
    )
  }
  
  async updateWithRetry<T>(
    table: string,
    data: any,
    match: Record<string, any>
  ): Promise<{ data: T | null; error: any }> {
    return withRetry(
      async () => {
        let query = this.supabase.from(table).update(data)
        
        // Apply match conditions
        Object.entries(match).forEach(([key, value]) => {
          query = query.eq(key, value)
        })
        
        return await query.select().single()
      },
      `update ${table}`
    )
  }
  
  async deleteWithRetry(
    table: string,
    match: Record<string, any>
  ): Promise<{ error: any }> {
    return withRetry(
      async () => {
        let query = this.supabase.from(table).delete()
        
        // Apply match conditions
        Object.entries(match).forEach(([key, value]) => {
          query = query.eq(key, value)
        })
        
        return await query
      },
      `delete from ${table}`
    )
  }
  
  async rpcWithRetry<T>(
    functionName: string,
    params?: Record<string, any>
  ): Promise<{ data: T | null; error: any }> {
    return withRetry(
      async () => {
        return await this.supabase.rpc(functionName, params)
      },
      `rpc ${functionName}`
    )
  }
}

/**
 * Helper to execute multiple operations with transaction-like behavior
 */
export async function withTransaction<T>(
  supabase: SupabaseClient,
  operations: Array<() => Promise<any>>,
  rollback?: () => Promise<void>
): Promise<T[]> {
  const results: T[] = []
  let completedOps = 0
  
  try {
    for (const operation of operations) {
      const result = await withRetry(
        operation,
        `transaction operation ${completedOps + 1}`
      )
      results.push(result)
      completedOps++
    }
    
    return results
  } catch (error) {
    logger.error('Transaction failed, attempting rollback', {
      error: error as Error,
      metadata: { completedOps, totalOps: operations.length }
    })
    
    if (rollback) {
      try {
        await rollback()
        logger.info('Transaction rollback completed')
      } catch (rollbackError) {
        logger.error('Transaction rollback failed', {
          error: rollbackError as Error
        })
      }
    }
    
    throw error
  }
}