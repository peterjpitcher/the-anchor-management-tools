'use server'

import { createClient } from '@supabase/supabase-js'
import { logAuditEvent, getCurrentUserForAudit } from '@/lib/auditLog'
import type { Employee } from '@/types/database'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.')
    return null
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

interface ExportOptions {
  format: 'csv' | 'json'
  includeFields?: string[]
  statusFilter?: 'all' | 'Active' | 'Former'
}

export async function exportEmployees(options: ExportOptions): Promise<{ data?: string; error?: string; filename?: string }> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return { error: 'Database connection failed' }
  }

  try {
    // Fetch employees
    let query = supabase.from('employees').select('*').order('last_name').order('first_name')
    
    if (options.statusFilter && options.statusFilter !== 'all') {
      query = query.eq('status', options.statusFilter)
    }

    const { data: employees, error } = await query

    if (error) {
      throw error
    }

    if (!employees || employees.length === 0) {
      return { error: 'No employees found to export' }
    }

    // Audit log the export
    const userInfo = await getCurrentUserForAudit(supabase)
    await logAuditEvent({
      ...userInfo,
      operationType: 'export',
      resourceType: 'employee',
      operationStatus: 'success',
      additionalInfo: {
        format: options.format,
        recordCount: employees.length,
        statusFilter: options.statusFilter
      }
    })

    // Generate export based on format
    let exportData: string
    let filename: string
    const timestamp = new Date().toISOString().split('T')[0]

    if (options.format === 'csv') {
      exportData = generateCSV(employees, options.includeFields)
      filename = `employees_export_${timestamp}.csv`
    } else {
      exportData = generateJSON(employees, options.includeFields)
      filename = `employees_export_${timestamp}.json`
    }

    return { data: exportData, filename }
  } catch (error) {
    console.error('Export error:', error)
    return { error: 'Failed to export employees' }
  }
}

function generateCSV(employees: Employee[], includeFields?: string[]): string {
  // Define default fields if none specified
  const defaultFields = [
    'employee_id',
    'first_name',
    'last_name',
    'email_address',
    'job_title',
    'phone_number',
    'employment_start_date',
    'employment_end_date',
    'status',
    'date_of_birth',
    'address'
  ]

  const fields = includeFields && includeFields.length > 0 ? includeFields : defaultFields
  
  // Create header row
  const headers = fields.map(field => {
    // Convert field names to readable headers
    return field
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  })
  
  const csvRows = [headers.join(',')]

  // Add data rows
  for (const employee of employees) {
    const values = fields.map(field => {
      const value = (employee as any)[field]
      
      // Handle null/undefined
      if (value === null || value === undefined) {
        return ''
      }
      
      // Handle dates
      if (field.includes('date') && value) {
        return new Date(value).toLocaleDateString('en-GB')
      }
      
      // Escape commas and quotes in strings
      if (typeof value === 'string') {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return value
      }
      
      return String(value)
    })
    
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}

function generateJSON(employees: Employee[], includeFields?: string[]): string {
  if (!includeFields || includeFields.length === 0) {
    // Return all fields except sensitive ones
    const sanitized = employees.map(emp => {
      const { created_at, ...rest } = emp
      return rest
    })
    return JSON.stringify(sanitized, null, 2)
  }

  // Return only requested fields
  const filtered = employees.map(emp => {
    const filtered: any = {}
    for (const field of includeFields) {
      if (field in emp) {
        filtered[field] = (emp as any)[field]
      }
    }
    return filtered
  })

  return JSON.stringify(filtered, null, 2)
}