import { useState, useEffect, useCallback } from 'react'
import { SupabaseClient } from '@supabase/supabase-js'

interface PaginationOptions {
  pageSize?: number
  initialPage?: number
  searchTerm?: string
  searchColumns?: string[]
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

export function usePagination<T>(
  supabase: SupabaseClient,
  tableName: string,
  query?: {
    select?: string
    orderBy?: { column: string; ascending?: boolean }
    filters?: Array<{ column: string; operator: string; value: unknown }>
  },
  options?: PaginationOptions
): PaginationResult<T> {
  const pageSize = options?.pageSize || 25
  const searchTerm = options?.searchTerm || ''
  const searchColumns = options?.searchColumns || []
  
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
      let countQuery = supabase.from(tableName).select('*', { count: 'exact', head: true })
      let dataQuery = supabase.from(tableName).select(query?.select || '*')

      // Apply filters
      if (query?.filters) {
        for (const filter of query.filters) {
          countQuery = (countQuery as any)[filter.operator](filter.column, filter.value)
          dataQuery = (dataQuery as any)[filter.operator](filter.column, filter.value)
        }
      }

      // Apply search filter
      if (searchTerm && searchColumns.length > 0) {
        const searchPattern = `%${searchTerm}%`
        const orConditions = searchColumns.map(col => `${col}.ilike.${searchPattern}`).join(',')
        countQuery = countQuery.or(orConditions)
        dataQuery = dataQuery.or(orConditions)
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
  }, [supabase, tableName, query, currentPage, pageSize, searchTerm, searchColumns])

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