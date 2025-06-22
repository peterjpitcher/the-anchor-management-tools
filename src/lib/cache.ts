/**
 * Caching utilities for improving performance
 * Provides in-memory and Redis-based caching strategies
 */

import { Redis } from '@upstash/redis'
import { isFeatureConfigured } from './env-validation'
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
 * In-memory cache for development and fallback
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
 * Redis-based cache for production
 */
class RedisCache {
  private redis: Redis
  
  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  }
  
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key)
      return value as T | null
    } catch (error) {
      logger.error('Redis get error', { error: error as Error, metadata: { key } })
      return null
    }
  }
  
  async set(key: string, value: any, ttl: number): Promise<void> {
    try {
      await this.redis.setex(key, ttl, JSON.stringify(value))
    } catch (error) {
      logger.error('Redis set error', { error: error as Error, metadata: { key } })
    }
  }
  
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key)
    } catch (error) {
      logger.error('Redis delete error', { error: error as Error, metadata: { key } })
    }
  }
  
  async flush(pattern?: string): Promise<void> {
    try {
      if (!pattern) {
        await this.redis.flushdb()
        return
      }
      
      // Find and delete keys matching pattern
      const keys = await this.redis.keys(`*${pattern}*`)
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } catch (error) {
      logger.error('Redis flush error', { error: error as Error, metadata: { pattern } })
    }
  }
}

/**
 * Cache manager that handles both in-memory and Redis caching
 */
export class CacheManager {
  private static instance: CacheManager
  private memoryCache: InMemoryCache
  private redisCache: RedisCache | null
  
  private constructor() {
    this.memoryCache = new InMemoryCache()
    this.redisCache = isFeatureConfigured('redis') ? new RedisCache() : null
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
    // Try memory cache first
    const memoryValue = await this.memoryCache.get<T>(key)
    if (memoryValue !== null) {
      return memoryValue
    }
    
    // Try Redis if available
    if (this.redisCache) {
      const redisValue = await this.redisCache.get<T>(key)
      if (redisValue !== null) {
        // Populate memory cache
        await this.memoryCache.set(key, redisValue, DEFAULT_TTL.SHORT)
        return redisValue
      }
    }
    
    return null
  }
  
  /**
   * Set a value in cache
   */
  async set(key: string, value: any, ttl: CacheTTL | number): Promise<void> {
    const ttlSeconds = typeof ttl === 'number' ? ttl : DEFAULT_TTL[ttl]
    
    // Set in both caches
    await this.memoryCache.set(key, value, ttlSeconds)
    if (this.redisCache) {
      await this.redisCache.set(key, value, ttlSeconds)
    }
  }
  
  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    await this.memoryCache.delete(key)
    if (this.redisCache) {
      await this.redisCache.delete(key)
    }
  }
  
  /**
   * Flush cache by pattern
   */
  async flush(prefix?: CachePrefix): Promise<void> {
    const pattern = prefix ? CACHE_PREFIXES[prefix] : undefined
    await this.memoryCache.flush(pattern)
    if (this.redisCache) {
      await this.redisCache.flush(pattern)
    }
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
      redisEnabled: !!this.redisCache,
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