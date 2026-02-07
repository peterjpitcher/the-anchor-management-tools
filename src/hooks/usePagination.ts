import { useState, useEffect, useCallback } from 'react'
import type { createClient } from '@/lib/supabase/client'

type SupabaseClientType = ReturnType<typeof createClient>

interface PaginationOptions {
  pageSize?: number
  initialPage?: number
  searchTerm?: string
  searchColumns?: string[]
  countMode?: 'exact' | 'planned' | 'estimated'
}

interface PaginationResult<T> {
  data: T[]
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: number
  isLoading: boolean
  error: Error | null
  setPage: (page: number) => void
  refresh: () => void
}

type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'ilike'
  | 'like'
  | 'is'
  | 'in'
  | 'contains'

export function usePagination<T>(
  supabase: SupabaseClientType,
  tableName: string,
  query?: {
    select?: string
    orderBy?: { column: string; ascending?: boolean }
    filters?: Array<{ column: string; operator: FilterOperator; value: any }>
    or?: string
  },
  options?: PaginationOptions
): PaginationResult<T> {
  const pageSize = options?.pageSize || 25
  const searchTerm = options?.searchTerm || ''
  const searchColumns = options?.searchColumns || []
  const countMode = options?.countMode || 'exact'
  
  const [currentPage, setCurrentPage] = useState(options?.initialPage || 1)
  const [data, setData] = useState<T[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Build the query
      let countQuery = supabase.from(tableName).select('*', { count: countMode, head: true })
      let dataQuery = supabase.from(tableName).select(query?.select || '*')

      // Apply filters
      if (query?.filters) {
        for (const filter of query.filters) {
          switch (filter.operator) {
            case 'eq':
              countQuery = countQuery.eq(filter.column, filter.value)
              dataQuery = dataQuery.eq(filter.column, filter.value)
              break
            case 'neq':
              countQuery = countQuery.neq(filter.column, filter.value)
              dataQuery = dataQuery.neq(filter.column, filter.value)
              break
            case 'gt':
              countQuery = countQuery.gt(filter.column, filter.value)
              dataQuery = dataQuery.gt(filter.column, filter.value)
              break
            case 'gte':
              countQuery = countQuery.gte(filter.column, filter.value)
              dataQuery = dataQuery.gte(filter.column, filter.value)
              break
            case 'lt':
              countQuery = countQuery.lt(filter.column, filter.value)
              dataQuery = dataQuery.lt(filter.column, filter.value)
              break
            case 'lte':
              countQuery = countQuery.lte(filter.column, filter.value)
              dataQuery = dataQuery.lte(filter.column, filter.value)
              break
            case 'ilike':
              countQuery = countQuery.ilike(filter.column, filter.value)
              dataQuery = dataQuery.ilike(filter.column, filter.value)
              break
            case 'like':
              countQuery = countQuery.like(filter.column, filter.value)
              dataQuery = dataQuery.like(filter.column, filter.value)
              break
            case 'is':
              countQuery = countQuery.is(filter.column, filter.value)
              dataQuery = dataQuery.is(filter.column, filter.value)
              break
            case 'in':
              countQuery = countQuery.in(
                filter.column,
                filter.value as readonly (string | number | boolean | null)[]
              )
              dataQuery = dataQuery.in(
                filter.column,
                filter.value as readonly (string | number | boolean | null)[]
              )
              break
            case 'contains':
              countQuery = countQuery.contains(
                filter.column,
                filter.value as string | readonly unknown[] | Record<string, unknown>
              )
              dataQuery = dataQuery.contains(
                filter.column,
                filter.value as string | readonly unknown[] | Record<string, unknown>
              )
              break
          }
        }
      }

      // Apply search filter
      if (searchTerm && searchColumns.length > 0) {
        const searchPattern = `%${searchTerm}%`
        const orConditions = searchColumns.map(col => `${col}.ilike.${searchPattern}`).join(',')
        countQuery = countQuery.or(orConditions)
        dataQuery = dataQuery.or(orConditions)
      }

      // Apply raw OR conditions if provided
      if (query?.or) {
        countQuery = countQuery.or(query.or)
        dataQuery = dataQuery.or(query.or)
      }

      // Get total count
      const { count, error: countError } = await countQuery
      if (countError) throw countError
      setTotalCount(count || 0)

      // Apply ordering
      if (query?.orderBy) {
        dataQuery = dataQuery.order(query.orderBy.column, {
          ascending: query.orderBy.ascending ?? true
        })
      }

      // Apply pagination
      const from = (currentPage - 1) * pageSize
      const to = from + pageSize - 1
      dataQuery = dataQuery.range(from, to)

      // Get data
      const { data: pageData, error: dataError } = await dataQuery
      if (dataError) throw dataError

      setData((pageData || []) as T[])
    } catch (err) {
      setError(err as Error)
      console.error('Pagination error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, tableName, query, currentPage, pageSize, searchTerm, searchColumns, countMode])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    data,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading,
    error,
    setPage: setCurrentPage,
    refresh: fetchData
  }
}
