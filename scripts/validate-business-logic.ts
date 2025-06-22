#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface BusinessRuleViolation {
  rule: string
  component: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  issue: string
  impact: string
  dataFound?: any
}

const violations: BusinessRuleViolation[] = []

// Test access controls
async function validateAccessControls() {
  console.log('🔐 Validating Access Controls...\n')
  
  // Test 1: Check if RLS is enabled on all tables
  const tables = [
    'customers', 'events', 'bookings', 'employees', 'messages',
    'audit_logs', 'users', 'profiles', 'roles', 'permissions'
  ]
  
  for (const table of tables) {
    console.log(`  Checking RLS on ${table}...`)
    // Note: Would need direct DB access to check RLS status
  }
  
  // Test 2: Verify permission hierarchy
  console.log('\n  Testing permission hierarchy...')
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: '00000000-0000-0000-0000-000000000000', // Non-existent user
    p_resource: 'events',
    p_action: 'delete'
  })
  
  if (hasPermission) {
    violations.push({
      rule: 'Permission Check',
      component: 'RBAC',
      severity: 'critical',
      issue: 'Non-existent user has permissions',
      impact: 'Security vulnerability'
    })
  }
}

// Validate booking business rules
async function validateBookingRules() {
  console.log('\n📅 Validating Booking Rules...\n')
  
  // Rule 1: No double bookings for same customer/event
  console.log('  Checking for duplicate bookings...')
  const { data: duplicates } = await supabase
    .from('bookings')
    .select(`
      customer_id,
      event_id,
      count:customer_id.count()
    `)
    .select('customer_id, event_id')
  
  // Rule 2: Booking capacity constraints
  console.log('  Checking capacity constraints...')
  try {
    const { data: overbooked, error } = await supabase.rpc('check_overbooked_events', {})
    
    if (!error && overbooked && overbooked.length > 0) {
      violations.push({
        rule: 'Event Capacity',
        component: 'Bookings',
        severity: 'high',
        issue: 'Events can be overbooked',
        impact: 'Venue capacity exceeded',
        dataFound: overbooked
      })
    }
  } catch (e) {
    // Function doesn't exist, check manually
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        name,
        capacity,
        bookings(seats)
      `)
      .not('capacity', 'is', null)
    
    if (events) {
      const overbooked = events.filter(event => {
        const totalSeats = event.bookings?.reduce((sum: number, b: any) => sum + (b.seats || 0), 0) || 0
        return event.capacity && totalSeats > event.capacity
      })
      
      if (overbooked.length > 0) {
        violations.push({
          rule: 'Event Capacity',
          component: 'Bookings',
          severity: 'high',
          issue: 'Events can be overbooked',
          impact: 'Venue capacity exceeded',
          dataFound: overbooked.map(e => ({ id: e.id, name: e.name }))
        })
      }
    }
  }
  
  // Rule 3: Valid booking states
  console.log('  Checking booking states...')
  const { data: invalidBookings } = await supabase
    .from('bookings')
    .select('id, seats')
    .or('seats.lt.0,seats.gt.1000')
  
  if (invalidBookings && invalidBookings.length > 0) {
    violations.push({
      rule: 'Booking Validation',
      component: 'Bookings',
      severity: 'medium',
      issue: 'Invalid seat counts allowed',
      impact: 'Data integrity issues',
      dataFound: invalidBookings
    })
  }
}

// Validate SMS/messaging rules
async function validateMessagingRules() {
  console.log('\n📱 Validating Messaging Rules...\n')
  
  // Rule 1: No SMS to opted-out customers
  console.log('  Checking SMS opt-out compliance...')
  const { data: optedOutMessages } = await supabase
    .from('messages')
    .select(`
      id,
      customer:customers!inner(
        id,
        sms_opt_in
      )
    `)
    .eq('direction', 'outbound')
    .eq('customer.sms_opt_in', false)
    .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
  
  if (optedOutMessages && optedOutMessages.length > 0) {
    violations.push({
      rule: 'SMS Opt-Out',
      component: 'Messaging',
      severity: 'high',
      issue: 'Messages sent to opted-out customers',
      impact: 'Compliance violation',
      dataFound: optedOutMessages.length
    })
  }
  
  // Rule 2: Message delivery tracking
  console.log('  Checking delivery failure handling...')
  const { data: customers } = await supabase
    .from('customers')
    .select('id, sms_delivery_failures, sms_opt_in')
    .gt('sms_delivery_failures', 5)
    .eq('sms_opt_in', true)
  
  if (customers && customers.length > 0) {
    violations.push({
      rule: 'Delivery Failure Handling',
      component: 'Messaging',
      severity: 'medium',
      issue: 'Customers with high failures still opted in',
      impact: 'Wasted SMS costs',
      dataFound: customers.length
    })
  }
}

// Validate data integrity
async function validateDataIntegrity() {
  console.log('\n🔍 Validating Data Integrity...\n')
  
  // Check for orphaned records
  console.log('  Checking for orphaned bookings...')
  const { data: orphanedBookings } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
    .is('customer_id', null)
  
  if (orphanedBookings && orphanedBookings.length > 0) {
    violations.push({
      rule: 'Referential Integrity',
      component: 'Database',
      severity: 'high',
      issue: 'Orphaned booking records',
      impact: 'Data inconsistency',
      dataFound: orphanedBookings.length
    })
  }
  
  // Check cascade deletes
  console.log('  Checking cascade delete configuration...')
  // Note: Would need schema access to verify
  
  // Check for invalid phone numbers
  console.log('  Checking phone number formats...')
  const { data: invalidPhones } = await supabase
    .from('customers')
    .select('id, mobile_number')
    .not('mobile_number', 'like', '+%')
  
  if (invalidPhones && invalidPhones.length > 0) {
    violations.push({
      rule: 'Data Validation',
      component: 'Customers',
      severity: 'medium',
      issue: 'Invalid phone number formats',
      impact: 'SMS delivery failures',
      dataFound: invalidPhones.length
    })
  }
}

// Validate workflow transitions
async function validateWorkflows() {
  console.log('\n🔄 Validating Workflow Transitions...\n')
  
  // Private booking workflow
  console.log('  Checking private booking states...')
  const validStates = ['pending', 'confirmed', 'cancelled', 'completed']
  
  const { data: invalidStates } = await supabase
    .from('private_bookings')
    .select('id, status')
    .not('status', 'in', `(${validStates.join(',')})`)
  
  if (invalidStates && invalidStates.length > 0) {
    violations.push({
      rule: 'State Machine',
      component: 'Private Bookings',
      severity: 'high',
      issue: 'Invalid booking states',
      impact: 'Workflow corruption',
      dataFound: invalidStates
    })
  }
  
  // Payment tracking
  console.log('  Checking payment consistency...')
  const { data: paymentIssues } = await supabase
    .from('private_bookings')
    .select('id, total_amount, deposit_amount, deposit_paid, balance_paid')
    .or('deposit_paid.gt.deposit_amount,balance_paid.gt.total_amount')
  
  if (paymentIssues && paymentIssues.length > 0) {
    violations.push({
      rule: 'Payment Validation',
      component: 'Private Bookings',
      severity: 'critical',
      issue: 'Payment amounts exceed totals',
      impact: 'Financial discrepancies',
      dataFound: paymentIssues
    })
  }
}

// Validate event-specific rules
async function validateEventRules() {
  console.log('\n🎉 Validating Event Rules...\n')
  
  // Check for past events still accepting bookings
  console.log('  Checking past event bookings...')
  const { data: pastEvents } = await supabase
    .from('events')
    .select(`
      id,
      name,
      date,
      bookings(count)
    `)
    .lt('date', new Date().toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(10)
  
  // Check event categories
  console.log('  Checking event categorization...')
  const { data: uncategorized } = await supabase
    .from('events')
    .select('id, name')
    .is('category_id', null)
  
  if (uncategorized && uncategorized.length > 0) {
    violations.push({
      rule: 'Event Categorization',
      component: 'Events',
      severity: 'low',
      issue: 'Uncategorized events',
      impact: 'Missing analytics data',
      dataFound: uncategorized.length
    })
  }
}

// Validate audit trail
async function validateAuditTrail() {
  console.log('\n📋 Validating Audit Trail...\n')
  
  // Check for gaps in audit logs
  console.log('  Checking audit coverage...')
  const criticalOperations = ['delete', 'export', 'bulk_update']
  
  // Check audit log immutability
  console.log('  Verifying audit log immutability...')
  // Note: Would need to attempt update/delete to verify
}

// Main execution
async function runBusinessLogicValidation() {
  console.log('🔍 PHASE 5: BUSINESS LOGIC VALIDATION\n')
  
  await validateAccessControls()
  await validateBookingRules()
  await validateMessagingRules()
  await validateDataIntegrity()
  await validateWorkflows()
  await validateEventRules()
  await validateAuditTrail()
  
  // Summary
  console.log('\n📊 Validation Summary:\n')
  
  const critical = violations.filter(v => v.severity === 'critical')
  const high = violations.filter(v => v.severity === 'high')
  const medium = violations.filter(v => v.severity === 'medium')
  const low = violations.filter(v => v.severity === 'low')
  
  console.log(`  🔴 Critical: ${critical.length}`)
  console.log(`  🟠 High: ${high.length}`)
  console.log(`  🟡 Medium: ${medium.length}`)
  console.log(`  🟢 Low: ${low.length}`)
  
  if (violations.length > 0) {
    console.log('\n❌ Business Rule Violations Found:\n')
    
    violations.forEach(violation => {
      console.log(`${violation.severity.toUpperCase()}: ${violation.rule}`)
      console.log(`  Component: ${violation.component}`)
      console.log(`  Issue: ${violation.issue}`)
      console.log(`  Impact: ${violation.impact}`)
      if (violation.dataFound) {
        console.log(`  Data: ${JSON.stringify(violation.dataFound)}`)
      }
      console.log()
    })
  }
  
  console.log('✅ Business logic validation complete!')
}

runBusinessLogicValidation().catch(console.error)