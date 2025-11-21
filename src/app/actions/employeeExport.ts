'use server'

import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import type { Employee } from '@/types/database'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { checkUserPermission } from './rbac'
import { EmployeeService } from '@/services/employees'

interface ExportOptions {
  format: 'csv' | 'json'
  includeFields?: string[]
  statusFilter?: 'all' | 'Active' | 'Former' | 'Prospective'
}

export async function exportEmployees(options: ExportOptions): Promise<{ data?: string; error?: string; filename?: string }> {
  const hasPermission = await checkUserPermission('employees', 'export')
  if (!hasPermission) {
    return { error: 'You do not have permission to export employees.' }
  }

  try {
    const employees = await EmployeeService.exportEmployeesData(options)

    if (!employees || employees.length === 0) {
      return { error: 'No employees found to export' }
    }

    // Audit log the export
    const userInfo = await getCurrentUser()
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'export',
      resource_type: 'employee',
      operation_status: 'success',
      additional_info: {
        format: options.format,
        recordCount: employees.length,
        statusFilter: options.statusFilter
      }
    })

    // Generate export based on format
    let exportData: string
    let filename: string
    const timestamp = getTodayIsoDate()

    if (options.format === 'csv') {
      exportData = EmployeeService.generateCSV(employees, options.includeFields)
      filename = `employees_export_${timestamp}.csv`
    } else {
      exportData = EmployeeService.generateJSON(employees, options.includeFields)
      filename = `employees_export_${timestamp}.json`
    }

    return { data: exportData, filename }
  } catch (error: any) {
    console.error('Export error:', error)
    return { error: error.message || 'Failed to export employees' }
  }
}