'use server'

import { checkUserPermission } from './rbac'
import { EmployeeService } from '@/services/employees'
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
  const canView = await checkUserPermission('employees', 'view')

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
    const result = await EmployeeService.getEmployeesRoster({
      page: requestedPage,
      pageSize,
      searchTerm,
      statusFilter
    })

    return result;
  } catch (error: any) {
    console.error('[getEmployeesRoster] Failed to fetch employees roster:', error)
    return {
      ...emptyResult,
      error: error.message || 'Failed to load employees.'
    }
  }
}