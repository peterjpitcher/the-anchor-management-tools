#!/usr/bin/env tsx
/**
 * Test script to diagnose audit log RLS policy violation error
 * Tests different approaches to creating audit logs
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

async function testAuditLogCreation() {
  console.log('🔍 Testing Audit Log Creation and RLS Policies\n')

  try {
    // Test 1: Using regular authenticated client
    console.log('1️⃣ Testing with regular authenticated client...')
    const supabase = await createClient()
    
    const { data: user, error: userError } = await supabase.auth.getUser()
    console.log('Current user:', user?.user?.email || 'Not authenticated')
    
    const { error: regularError } = await supabase
      .from('audit_logs')
      .insert({
        user_id: user?.user?.id || 'test-user-id',
        operation_type: 'test',
        resource_type: 'system',
        operation_status: 'success',
        additional_info: { test: true, method: 'regular_client' }
      })
    
    if (regularError) {
      console.log('❌ Regular client failed:', regularError.message)
      console.log('   Error code:', regularError.code)
      console.log('   Details:', regularError.details)
    } else {
      console.log('✅ Regular client succeeded!')
    }

    // Test 2: Using admin/service role client
    console.log('\n2️⃣ Testing with admin/service role client...')
    const adminSupabase = createAdminClient()
    
    const { error: adminError } = await adminSupabase
      .from('audit_logs')
      .insert({
        user_id: user?.user?.id || 'test-user-id',
        operation_type: 'test',
        resource_type: 'system',
        operation_status: 'success',
        additional_info: { test: true, method: 'admin_client' }
      })
    
    if (adminError) {
      console.log('❌ Admin client failed:', adminError.message)
      console.log('   Error code:', adminError.code)
      console.log('   Details:', adminError.details)
    } else {
      console.log('✅ Admin client succeeded!')
    }

    // Test 3: Check current RLS policies
    console.log('\n3️⃣ Checking current RLS policies on audit_logs table...')
    const { data: policies, error: policyError } = await adminSupabase
      .rpc('get_policies_for_table', { table_name: 'audit_logs' })
      .single()
    
    if (policyError) {
      // Alternative method to check policies
      const { data: policyData } = await adminSupabase
        .from('pg_policies')
        .select('*')
        .eq('tablename', 'audit_logs')
      
      console.log('Policies found:', policyData?.length || 0)
      policyData?.forEach(policy => {
        console.log(`\n   Policy: ${policy.policyname}`)
        console.log(`   Command: ${policy.cmd}`)
        console.log(`   Roles: ${policy.roles}`)
        console.log(`   Using: ${policy.qual}`)
        console.log(`   With Check: ${policy.with_check}`)
      })
    } else {
      console.log('Policies:', policies)
    }

    // Test 4: Query existing audit logs to verify read access
    console.log('\n4️⃣ Testing read access to audit_logs...')
    const { data: logs, error: readError } = await supabase
      .from('audit_logs')
      .select('id, operation_type, resource_type, created_at')
      .limit(5)
      .order('created_at', { ascending: false })
    
    if (readError) {
      console.log('❌ Read access failed:', readError.message)
    } else {
      console.log(`✅ Read access succeeded! Found ${logs?.length || 0} recent logs`)
    }

    // Test 5: Direct SQL query to check policy definition
    console.log('\n5️⃣ Checking exact policy definitions via SQL...')
    const { data: sqlPolicies, error: sqlError } = await adminSupabase.rpc('query_policies')
    
    if (!sqlError && sqlPolicies) {
      console.log('Policy definitions:', JSON.stringify(sqlPolicies, null, 2))
    }

  } catch (error) {
    console.error('\n❌ Unexpected error:', error)
  }
}

// Add helper RPC function to query policies (if not exists)
async function createHelperFunction() {
  const adminSupabase = createAdminClient()
  
  await adminSupabase.rpc('query_policies', {}, {
    body: `
      CREATE OR REPLACE FUNCTION query_policies()
      RETURNS json AS $$
      BEGIN
        RETURN (
          SELECT json_agg(row_to_json(p))
          FROM pg_policies p
          WHERE p.tablename = 'audit_logs'
        );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `
  }).catch(() => {
    // Function might already exist
  })
}

// Run the tests
console.log('🚀 Starting Audit Log RLS Policy Tests...\n')
testAuditLogCreation()
  .then(() => {
    console.log('\n✅ Tests completed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })