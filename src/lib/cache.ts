/**
 * Caching utilities for improving performance
 * Provides in-memory caching strategy
 */

import { logger } from './logger'

// Cache key prefixes
const CACHE_PREFIXES = {
  EVENT: 'event:',
  CUSTOMER: 'customer:',
  EMPLOYEE: 'employee:',
  TEMPLATE: 'template:',
  STATS: 'stats:',
  CAPACITY: 'capacity:',
  PERMISSION: 'permission:',
} as const

// Default TTL values (in seconds)
const DEFAULT_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
} as const

export type CachePrefix = keyof typeof CACHE_PREFIXES
export type CacheTTL = keyof typeof DEFAULT_TTL

/**
 * In-memory cache
 */
class InMemoryCache {
  private cache = new Map<string, { value: any; expires: number }>()
  
  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key)
    if (!item) return null
    
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }
    
    return item.value as T
  }
  
  async set(key: string, value: any, ttl: number): Promise<void> {
    const expires = Date.now() + (ttl * 1000)
    this.cache.set(key, { value, expires })
  }
  
  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }
  
  async flush(pattern?: string): Promise<void> {
    if (!pattern) {
      this.cache.clear()
      return
    }
    
    // Delete keys matching pattern
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }
  
  getSize(): number {
    return this.cache.size
  }
}

/**
 * Cache manager that handles in-memory caching
 */
export class CacheManager {
  private static instance: CacheManager
  private memoryCache: InMemoryCache
  
  private constructor() {
    this.memoryCache = new InMemoryCache()
  }
  
  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager()
    }
    return CacheManager.instance
  }
  
  /**
   * Build a cache key with proper namespacing
   */
  buildKey(prefix: CachePrefix, ...parts: (string | number)[]): string {
    return `${CACHE_PREFIXES[prefix]}${parts.join(':')}`
  }
  
  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    return await this.memoryCache.get<T>(key)
  }
  
  /**
   * Set a value in cache
   */
  async set(key: string, value: any, ttl: CacheTTL | number): Promise<void> {
    const ttlSeconds = typeof ttl === 'number' ? ttl : DEFAULT_TTL[ttl]
    await this.memoryCache.set(key, value, ttlSeconds)
  }
  
  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    await this.memoryCache.delete(key)
  }
  
  /**
   * Flush cache by pattern
   */
  async flush(prefix?: CachePrefix): Promise<void> {
    const pattern = prefix ? CACHE_PREFIXES[prefix] : undefined
    await this.memoryCache.flush(pattern)
  }
  
  /**
   * Get or set pattern - fetch from cache or compute and cache
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: CacheTTL | number
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }
    
    // Compute value
    const value = await factory()
    
    // Cache it
    await this.set(key, value, ttl)
    
    return value
  }
  
  /**
   * Invalidate related cache entries
   */
  async invalidateRelated(entity: 'event' | 'customer' | 'employee', id?: string): Promise<void> {
    switch (entity) {
      case 'event':
        await this.flush('EVENT')
        await this.flush('CAPACITY')
        await this.flush('STATS')
        break
      case 'customer':
        if (id) {
          await this.delete(this.buildKey('CUSTOMER', id))
        }
        await this.flush('STATS')
        break
      case 'employee':
        if (id) {
          await this.delete(this.buildKey('EMPLOYEE', id))
        }
        break
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memorySize: this.memoryCache.getSize(),
    }
  }
}

// Export singleton instance
export const cache = CacheManager.getInstance()

/**
 * Cache decorator for class methods
 */
export function Cacheable(prefix: CachePrefix, ttl: CacheTTL = 'MEDIUM') {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    
    descriptor.value = async function (...args: any[]) {
      // Build cache key from method name and arguments
      const key = cache.buildKey(prefix, propertyKey, ...args.map(a => JSON.stringify(a)))
      
      // Try to get from cache
      const cached = await cache.get(key)
      if (cached !== null) {
        return cached
      }
      
      // Call original method
      const result = await originalMethod.apply(this, args)
      
      // Cache the result
      await cache.set(key, result, ttl)
      
      return result
    }
    
    return descriptor
  }
}

// Import React hooks only on client side
let useState: typeof import('react')['useState']
let useEffect: typeof import('react')['useEffect']
let useCallback: typeof import('react')['useCallback']

if (typeof window !== 'undefined') {
  const React = require('react')
  useState = React.useState
  useEffect = React.useEffect
  useCallback = React.useCallback
}

/**
 * React hook for client-side caching
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: CacheTTL = 'MEDIUM'
): { data: T | null; isLoading: boolean; error: Error | null; refresh: () => Promise<void> } {
  if (!useState || !useEffect || !useCallback) {
    throw new Error('useCachedData can only be used in client components')
  }
  
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await cache.getOrSet(key, fetcher, ttl)
      setData(result)
    } catch (err) {
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [key, fetcher, ttl])
  
  useEffect(() => {
    fetchData()
  }, [fetchData])
  
  const refresh = useCallback(async () => {
    await cache.delete(key)
    await fetchData()
  }, [key, fetchData])
  
  return { data, isLoading, error, refresh }
}