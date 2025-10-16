'use server'

import { checkUserPermission } from './rbac'
import { createAdminClient } from '@/lib/supabase/server'
import type { Employee } from '@/types/database'

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Prospective'

interface EmployeeRosterRequest {
  page?: number
  pageSize?: number
  searchTerm?: string
  statusFilter?: EmployeeStatus
}

interface EmployeeRosterPagination {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

interface EmployeeStatusCounts {
  all: number
  active: number
  former: number
  prospective: number
}

interface EmployeeRosterFilters {
  statusFilter: EmployeeStatus
  searchTerm: string
}

export interface EmployeeRosterResult {
  employees: Employee[]
  pagination: EmployeeRosterPagination
  statusCounts: EmployeeStatusCounts
  filters: EmployeeRosterFilters
  error?: string
}

export async function getEmployeesRoster(
  request: EmployeeRosterRequest = {}
): Promise<EmployeeRosterResult> {
  const [canView, supabase] = await Promise.all([
    checkUserPermission('employees', 'view'),
    Promise.resolve(createAdminClient())
  ])

  const pageSize = typeof request.pageSize === 'number' && request.pageSize > 0 ? request.pageSize : 50
  const requestedPage = typeof request.page === 'number' && request.page > 0 ? request.page : 1
  const rawStatus = request.statusFilter ?? 'Active'
  const statusFilter: EmployeeStatus = rawStatus === 'all' ? 'all' : (['Active', 'Former', 'Prospective'].includes(rawStatus) ? rawStatus : 'Active')
  const searchTerm = (request.searchTerm ?? '').trim()

  const emptyResult = {
    employees: [],
    pagination: {
      page: requestedPage,
      pageSize,
      totalCount: 0,
      totalPages: 0
    },
    statusCounts: {
      all: 0,
      active: 0,
      former: 0,
      prospective: 0
    },
    filters: {
      statusFilter,
      searchTerm
    },
    error: canView ? undefined : 'Insufficient permissions to view employees.'
  }

  if (!canView) {
    return emptyResult
  }

  try {
    const [allCountRes, activeCountRes, formerCountRes, prospectiveCountRes] = await Promise.all([
      supabase.from('employees').select('*', { count: 'exact', head: true }),
      supabase.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Active'),
      supabase.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Former'),
      supabase.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Prospective')
    ])

    if (allCountRes.error || activeCountRes.error || formerCountRes.error || prospectiveCountRes.error) {
      throw allCountRes.error || activeCountRes.error || formerCountRes.error || prospectiveCountRes.error
    }

    const applyFilters = <T>(query: T) => {
      let builder: any = query
      if (statusFilter !== 'all') {
        builder = builder.eq('status', statusFilter)
      }
      if (searchTerm) {
        const searchPattern = `%${searchTerm}%`
        builder = builder.or(
          [
            `first_name.ilike.${searchPattern}`,
            `last_name.ilike.${searchPattern}`,
            `email_address.ilike.${searchPattern}`,
            `job_title.ilike.${searchPattern}`
          ].join(',')
        )
      }
      return builder
    }

    const { count, error: countError } = await applyFilters(
      supabase.from('employees').select('*', { count: 'exact', head: true })
    )

    if (countError) {
      throw countError
    }

    const totalCount = count ?? 0
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)
    const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages)

    const from = (currentPage - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error: dataError } = await applyFilters(
      supabase
        .from('employees')
        .select('*')
        .order('employment_start_date', { ascending: true })
        .range(from, to)
    )

    if (dataError) {
      throw dataError
    }

    return {
      employees: (data ?? []) as Employee[],
      pagination: {
        page: currentPage,
        pageSize,
        totalCount,
        totalPages
      },
      statusCounts: {
        all: allCountRes.count ?? 0,
        active: activeCountRes.count ?? 0,
        former: formerCountRes.count ?? 0,
        prospective: prospectiveCountRes.count ?? 0
      },
      filters: {
        statusFilter,
        searchTerm
      }
    }
  } catch (error) {
    console.error('[getEmployeesRoster] Failed to fetch employees roster:', error)
    return {
      ...emptyResult,
      error: 'Failed to load employees.'
    }
  }
}
