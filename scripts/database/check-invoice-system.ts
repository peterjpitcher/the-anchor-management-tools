#!/usr/bin/env tsx
/**
 * Script to check if invoice system is properly configured in the database
 */

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

async function checkInvoiceSystem() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  console.log('🔍 Checking Invoice System Configuration...\n')
  
  const supabase = createAdminClient()

  function markFailure(message: string, error?: unknown) {
    process.exitCode = 1
    if (error) {
      console.error(`❌ ${message}`, error)
      return
    }
    console.error(`❌ ${message}`)
  }
  
  // 1. Check if invoice tables exist
  console.log('📊 Checking database tables...')
  const { data: tables, error: tablesError } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .in('table_name', [
      'invoices',
      'invoice_line_items',
      'invoice_vendors',
      'invoice_payments',
      'recurring_invoices',
      'recurring_invoice_line_items',
      'recurring_invoice_history',
      'quotes',
      'quote_line_items',
      'line_item_catalog',
      'invoice_series',
      'invoice_audit',
      'invoice_emails',
      'invoice_reminder_settings'
    ])
  
  if (tablesError) {
    markFailure('Error checking invoice tables.', tablesError)
  } else {
    console.log(`✅ Found ${tables?.length || 0} invoice-related tables:`)
    tables?.forEach(t => console.log(`   - ${t.table_name}`))
  }
  
  // 2. Check RBAC permissions for invoices module
  console.log('\n🔐 Checking RBAC permissions...')
  const { data: permissions, error: permError } = await supabase
    .from('rbac_permissions')
    .select('*')
    .eq('module', 'invoices')
  
  if (permError) {
    markFailure('Error checking invoice permissions.', permError)
  } else if (permissions?.length === 0) {
    console.log('⚠️  No invoice permissions found in RBAC system!')
  } else {
    console.log(`✅ Found ${permissions?.length || 0} invoice permissions:`)
    permissions?.forEach(p => console.log(`   - ${p.module}:${p.action} (${p.description})`))
  }
  
  // 3. Check if any role has invoice permissions
  console.log('\n👥 Checking role assignments...')
  const { data: rolePerms, error: rolePermError } = await supabase
    .from('rbac_role_permissions')
    .select(`
      role_id,
      permission_id,
      rbac_permissions!inner(module, action),
      rbac_roles!inner(name)
    `)
    .eq('rbac_permissions.module', 'invoices')
  
  if (rolePermError) {
    markFailure('Error checking role permissions for invoices module.', rolePermError)
  } else if (rolePerms?.length === 0) {
    console.log('⚠️  No roles have invoice permissions assigned!')
  } else {
    console.log(`✅ Roles with invoice permissions:`)
    const roleMap = new Map()
    rolePerms?.forEach((rp: any) => {
      const roleName = rp.rbac_roles?.name || rp.role_id
      if (!roleMap.has(roleName)) {
        roleMap.set(roleName, [])
      }
      roleMap.get(roleName).push(`${rp.rbac_permissions.module}:${rp.rbac_permissions.action}`)
    })
    
    roleMap.forEach((perms, role) => {
      console.log(`   - ${role}: ${perms.join(', ')}`)
    })
  }
  
  // 4. Check if there are any invoices in the database
  console.log('\n📄 Checking for existing invoices...')
  const { count: invoiceCount, error: invoiceError } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
  
  if (invoiceError) {
    if (invoiceError.message.includes('does not exist')) {
      console.log('❌ Invoice table does not exist!')
      markFailure('Invoice table does not exist.')
    } else {
      markFailure('Error checking invoices.', invoiceError)
    }
  } else {
    console.log(`✅ Found ${invoiceCount || 0} invoices in the database`)
  }
  
  // 5. Check recurring invoices
  console.log('\n🔄 Checking for recurring invoices...')
  const { count: recurringCount, error: recurringError } = await supabase
    .from('recurring_invoices')
    .select('*', { count: 'exact', head: true })
  
  if (recurringError) {
    if (recurringError.message.includes('does not exist')) {
      console.log('❌ Recurring invoices table does not exist!')
      markFailure('Recurring invoices table does not exist.')
    } else {
      markFailure('Error checking recurring invoices.', recurringError)
    }
  } else {
    console.log(`✅ Found ${recurringCount || 0} recurring invoice templates`)
  }
  
  // 6. Check if invoice series exists
  console.log('\n🔢 Checking invoice numbering series...')
  const { data: series, error: seriesError } = await supabase
    .from('invoice_series')
    .select('*')
  
  if (seriesError) {
    if (seriesError.message.includes('does not exist')) {
      console.log('❌ Invoice series table does not exist!')
      markFailure('Invoice series table does not exist.')
    } else {
      markFailure('Error checking invoice series.', seriesError)
    }
  } else if (series?.length === 0) {
    console.log('⚠️  No invoice series configured')
  } else {
    console.log(`✅ Invoice series configured:`)
    series?.forEach(s => console.log(`   - ${s.prefix}: ${s.current_number}`))
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('📋 Summary:')
  
  // Determine the issue
  if (!tables || tables.length === 0) {
    console.log('❌ CRITICAL: Invoice tables do not exist in the database!')
    console.log('   The invoice system code exists but the database tables are missing.')
    console.log('   This needs to be fixed by running the invoice system migration.')
    markFailure('Invoice tables are missing.')
  } else if (!permissions || permissions.length === 0) {
    console.log('⚠️  WARNING: Invoice tables exist but no RBAC permissions are configured.')
    console.log('   Users cannot access the invoice system without proper permissions.')
    markFailure('Invoice RBAC permissions are missing.')
  } else if (!rolePerms || rolePerms.length === 0) {
    console.log('⚠️  WARNING: Permissions exist but no roles have invoice access.')
    console.log('   Need to assign invoice permissions to appropriate roles.')
    markFailure('No roles have invoice permissions assigned.')
  } else {
    console.log('✅ Invoice system appears to be properly configured.')
    console.log('   If users cannot see it, check their role assignments.')
  }
}

void checkInvoiceSystem().catch((error) => {
  console.error('check-invoice-system failed.', error)
  process.exitCode = 1
})
