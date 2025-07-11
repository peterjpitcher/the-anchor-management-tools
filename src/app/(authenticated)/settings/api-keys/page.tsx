import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ApiKeysManager from './ApiKeysManager';

export const metadata: Metadata = {
  title: 'API Keys',
  description: 'Manage API keys for external integrations',
};

export default async function ApiKeysPage() {
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
    redirect('/dashboard');
  }

  // Fetch existing API keys
  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">API Key Management</h1>
      <ApiKeysManager initialKeys={apiKeys || []} />
    </div>
  );
}