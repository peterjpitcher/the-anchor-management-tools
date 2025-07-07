#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '.env.local' });
// Fallback to .env if .env.local doesn't have the required vars
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY)) {
  dotenv.config({ path: '.env' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkMessagesPermissions() {
  console.log('Checking messages module permissions...\n')

  // Check all permissions for messages module
  const { data: permissions, error } = await supabase
    .from('rbac_permissions')
    .select('*')
    .eq('module', 'messages')
    .order('action')

  if (error) {
    console.error('Error fetching permissions:', error)
    return
  }

  console.log('Messages module permissions in database:')
  console.log('=========================================')
  permissions?.forEach(perm => {
    console.log(`- ${perm.action} (ID: ${perm.id})`)
  })

  // Now let's check what permissions are actually being checked in the code
  console.log('\n\nPermissions being checked in code:')
  console.log('===================================')
  console.log('1. In twilio-messages/actions.ts: checkUserPermission("messages", "manage")')
  console.log('2. In job-queue.ts: checkUserPermission("messages", "send")')
  console.log('3. In messageActions.ts: NO permission check for sendSmsReply()')
  
  // Check if 'manage' permission exists
  const hasManage = permissions?.some(p => p.action === 'manage')
  const hasSend = permissions?.some(p => p.action === 'send')
  
  console.log('\n\nAnalysis:')
  console.log('=========')
  console.log(`- 'manage' permission exists: ${hasManage ? 'YES' : 'NO ❌'}`)
  console.log(`- 'send' permission exists: ${hasSend ? 'YES' : 'NO ❌'}`)
  
  if (!hasManage) {
    console.log('\n⚠️  WARNING: Code is checking for "messages.manage" but this permission does not exist!')
  }
  
  if (!hasSend) {
    console.log('\n⚠️  WARNING: Code is checking for "messages.send" but this permission does not exist!')
  }

  // Check role permissions
  console.log('\n\nRole permissions for messages module:')
  console.log('=====================================')
  
  const { data: rolePermissions, error: roleError } = await supabase
    .from('rbac_role_permissions')
    .select(`
      role:rbac_roles(name),
      permission:rbac_permissions(module, action)
    `)
    .eq('rbac_permissions.module', 'messages')

  if (roleError) {
    console.error('Error fetching role permissions:', roleError)
    return
  }

  const roleMap = new Map<string, string[]>()
  
  rolePermissions?.forEach(rp => {
    const roleName = rp.role?.name
    const action = rp.permission?.action
    if (roleName && action) {
      if (!roleMap.has(roleName)) {
        roleMap.set(roleName, [])
      }
      roleMap.get(roleName)!.push(action)
    }
  })

  roleMap.forEach((actions, role) => {
    console.log(`\n${role}:`)
    actions.sort().forEach(action => {
      console.log(`  - ${action}`)
    })
  })
}

checkMessagesPermissions().catch(console.error)