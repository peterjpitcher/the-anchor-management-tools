import { getUserPermissions } from '@/app/actions/rbac';
import AuthenticatedLayout from './AuthenticatedLayout';

export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Fetch permissions on the server
  const permissionsResult = await getUserPermissions();
  
  // Extract permissions or default to empty array if failed/not authenticated
  const initialPermissions = permissionsResult.success && permissionsResult.data 
    ? permissionsResult.data 
    : [];

  return (
    <AuthenticatedLayout initialPermissions={initialPermissions}>
      {children}
    </AuthenticatedLayout>
  );
}
