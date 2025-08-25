#!/usr/bin/env tsx

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

interface FieldMismatch {
  file: string
  formField: string
  issue: string
  line?: number
}

const mismatches: FieldMismatch[] = []

// Known database fields from schema analysis
const knownDatabaseFields = {
  private_bookings: [
    'id', 'created_at', 'customer_name', 'customer_email', 'customer_phone',
    'event_date', 'start_time', 'end_time', 'space_id', 'guest_count',
    'catering_required', 'bar_required', 'status', 'total_cost', 'deposit_paid',
    'notes', 'external_vendors', 'decorations_allowed', 'music_allowed',
    'cleaning_fee', 'security_deposit', 'additional_services', 'terms_accepted',
    'contract_signed_at', 'deposit_paid_at', 'balance_paid_at', 'cancelled_at',
    'cancellation_reason', 'event_type', 'special_requests', 'setup_time',
    'cleanup_time', 'alcohol_license_required', 'insurance_required',
    'catering_details', 'selected_catering_items', 'attendee_names',
    'emergency_contact_name', 'emergency_contact_phone', 'company_name',
    'billing_address', 'vat_number', 'purchase_order_number',
    'payment_method', 'payment_terms', 'invoice_notes',
    'actual_start_time', 'actual_end_time', 'actual_guest_count',
    'overtime_hours', 'overtime_charges', 'damage_assessment',
    'damage_charges', 'final_total', 'reviewed_by', 'reviewed_at'
  ],
  events: [
    'id', 'created_at', 'name', 'date', 'time', 'capacity', 'category_id',
    'description', 'price', 'image_url', 'is_recurring', 'recurrence_pattern',
    'recurrence_end_date', 'parent_event_id', 'google_calendar_event_id'
  ],
  customers: [
    'id', 'created_at', 'first_name', 'last_name', 'mobile_number',
    'sms_opt_in', 'sms_delivery_failures', 'last_sms_failure_reason',
    'last_successful_sms_at', 'sms_deactivated_at', 'sms_deactivation_reason',
    'messaging_status', 'last_successful_delivery', 'consecutive_failures',
    'total_failures_30d', 'last_failure_type'
  ],
  employees: [
    'employee_id', 'created_at', 'updated_at', 'first_name', 'last_name',
    'date_of_birth', 'address', 'phone_number', 'email_address', 'job_title',
    'employment_start_date', 'employment_end_date', 'status'
  ],
  bookings: [
    'id', 'created_at', 'customer_id', 'event_id', 'seats', 'notes'
  ],
  messages: [
    'id', 'created_at', 'updated_at', 'customer_id', 'direction',
    'message_sid', 'body', 'status', 'twilio_message_sid', 'error_code',
    'error_message', 'price', 'price_unit', 'sent_at', 'delivered_at',
    'failed_at', 'twilio_status', 'from_number', 'to_number', 'message_type',
    'read_at', 'segments', 'cost_usd'
  ]
}

// Scan for form fields in tsx files
function scanFormFields(filePath: string, content: string) {
  const lines = content.split('\n')
  
  // Look for formData.get() calls
  const formDataPattern = /formData\.get\(['"]([^'"]+)['"]\)/g
  let match
  while ((match = formDataPattern.exec(content)) !== null) {
    const fieldName = match[1]
    checkFieldValidity(filePath, fieldName, lines, match.index)
  }
  
  // Look for name= attributes in form elements
  const nameAttrPattern = /name=["']([^"']+)["']/g
  while ((match = nameAttrPattern.exec(content)) !== null) {
    const fieldName = match[1]
    checkFieldValidity(filePath, fieldName, lines, match.index)
  }
  
  // Look for database insert/update operations
  const insertPattern = /\.insert\([\s\S]*?\{([\s\S]*?)\}/g
  while ((match = insertPattern.exec(content)) !== null) {
    const insertContent = match[1]
    const fieldPattern = /(\w+):/g
    let fieldMatch
    while ((fieldMatch = fieldPattern.exec(insertContent)) !== null) {
      const fieldName = fieldMatch[1]
      checkFieldValidity(filePath, fieldName, lines, match.index + fieldMatch.index)
    }
  }
  
  // Look for update operations
  const updatePattern = /\.update\([\s\S]*?\{([\s\S]*?)\}/g
  while ((match = updatePattern.exec(content)) !== null) {
    const updateContent = match[1]
    const fieldPattern = /(\w+):/g
    let fieldMatch
    while ((fieldMatch = fieldPattern.exec(updateContent)) !== null) {
      const fieldName = fieldMatch[1]
      checkFieldValidity(filePath, fieldName, lines, match.index + fieldMatch.index)
    }
  }
}

function checkFieldValidity(filePath: string, fieldName: string, lines: string[], position: number) {
  // Determine table from file path
  let table: string | null = null
  
  if (filePath.includes('private-booking')) {
    table = 'private_bookings'
  } else if (filePath.includes('event')) {
    table = 'events'
  } else if (filePath.includes('customer')) {
    table = 'customers'
  } else if (filePath.includes('employee')) {
    table = 'employees'
  } else if (filePath.includes('booking')) {
    table = 'bookings'
  } else if (filePath.includes('message')) {
    table = 'messages'
  }
  
  if (table && table in knownDatabaseFields) {
    const validFields = knownDatabaseFields[table as keyof typeof knownDatabaseFields]
    if (!validFields.includes(fieldName) && 
        fieldName !== 'action' && // Skip form action fields
        fieldName !== 'id' &&     // Skip generic id fields
        !fieldName.startsWith('_')) { // Skip internal fields
      
      // Find line number
      let charCount = 0
      let lineNumber = 1
      for (const line of lines) {
        charCount += line.length + 1
        if (charCount > position) break
        lineNumber++
      }
      
      mismatches.push({
        file: filePath,
        formField: fieldName,
        issue: `Field '${fieldName}' not found in ${table} table`,
        line: lineNumber
      })
    }
  }
}

// Recursively scan directory
function scanDirectory(dir: string) {
  const entries = readdirSync(dir)
  
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    
    if (stat.isDirectory()) {
      if (!entry.startsWith('.') && entry !== 'node_modules') {
        scanDirectory(fullPath)
      }
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      const content = readFileSync(fullPath, 'utf-8')
      scanFormFields(fullPath, content)
    }
  }
}

// Main function
async function main() {
  console.log('🔍 Scanning for form field mismatches...\n')
  
  // Scan src directory
  scanDirectory(join(process.cwd(), 'src'))
  
  // Output results
  if (mismatches.length === 0) {
    console.log('✅ No form field mismatches found!')
  } else {
    console.log(`❌ Found ${mismatches.length} potential field mismatches:\n`)
    
    // Group by file
    const byFile = mismatches.reduce((acc, mismatch) => {
      if (!acc[mismatch.file]) acc[mismatch.file] = []
      acc[mismatch.file].push(mismatch)
      return acc
    }, {} as Record<string, FieldMismatch[]>)
    
    for (const [file, fileMismatches] of Object.entries(byFile)) {
      console.log(`\n📄 ${file}:`)
      for (const mismatch of fileMismatches) {
        console.log(`  Line ${mismatch.line}: ${mismatch.issue}`)
      }
    }
  }
}

main().catch(console.error)