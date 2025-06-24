'use server';

import { createClient } from '@/lib/supabase/server';
import { generateApiKey as genKey, hashApiKey } from '@/lib/api/auth';
import { redirect } from 'next/navigation';
import type { ApiKey } from '@/types/api';

interface CreateApiKeyData {
  name: string;
  description: string;
  permissions: string[];
  rate_limit: number;
}

export async function generateApiKey(data: CreateApiKeyData): Promise<{ apiKey: ApiKey; plainKey: string } | { error: string }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Check if user is super admin
  const { data: userRole } = await supabase
    .from('user_roles')
    .select('role:roles(name)')
    .eq('user_id', user.id)
    .single();

  const roleName = userRole?.role && typeof userRole.role === 'object' && 'name' in userRole.role
    ? userRole.role.name
    : null;

  if (roleName !== 'super_admin') {
    return { error: 'Unauthorized' };
  }

  try {
    // Generate new key
    const plainKey = await genKey();
    const keyHash = await hashApiKey(plainKey);

    // Insert into database
    const { data: apiKey, error } = await supabase
      .from('api_keys')
      .insert({
        key_hash: keyHash,
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
        rate_limit: data.rate_limit,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return { apiKey, plainKey };
  } catch (error) {
    console.error('Error creating API key:', error);
    return { error: 'Failed to create API key' };
  }
}

export async function revokeApiKey(keyId: string): Promise<{ success: boolean } | { error: string }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Check if user is super admin
  const { data: userRole } = await supabase
    .from('user_roles')
    .select('role:roles(name)')
    .eq('user_id', user.id)
    .single();

  const roleName = userRole?.role && typeof userRole.role === 'object' && 'name' in userRole.role
    ? userRole.role.name
    : null;

  if (roleName !== 'super_admin') {
    return { error: 'Unauthorized' };
  }

  try {
    const { error } = await supabase
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Error revoking API key:', error);
    return { error: 'Failed to revoke API key' };
  }
}