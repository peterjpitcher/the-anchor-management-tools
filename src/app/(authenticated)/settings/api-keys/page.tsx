import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ApiKeysManager from './ApiKeysManager';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Alert } from '@/components/ui-v2/feedback/Alert';

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
    return (
      <Page title="API Key Management">
        <Alert variant="error"
          title="Access Denied"
          description="Only super administrators can access this page."
        />
      </Page>
    );
  }

  // Fetch existing API keys
  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <Page
      title="API Key Management"
      description="Manage API keys for external integrations"
    >
      <ApiKeysManager initialKeys={apiKeys || []} />
    </Page>
  );
}