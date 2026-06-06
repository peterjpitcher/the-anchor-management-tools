import { getUserPermissions } from '@/app/actions/rbac';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import AuthenticatedLayout from './AuthenticatedLayout';

export const dynamic = 'force-dynamic';

const PORTAL_ONLY_ROLES = new Set(['portal_shift_manager']);

type UserRoleRow = {
  roles: { name: string | null } | { name: string | null }[] | null;
};

function roleNameFromRow(row: UserRoleRow): string | null {
  if (Array.isArray(row.roles)) return row.roles[0]?.name ?? null;
  return row.roles?.name ?? null;
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Guard: ensure user is authenticated before any permissions check.
  // (Middleware is temporarily disabled due to Vercel incident — restored at layout level.)
  const supabaseAuth = await createClient();
  const { data: { user: authUser } } = await supabaseAuth.auth.getUser();
  if (!authUser) {
    redirect('/auth/login');
  }

  const permissionsResult = await getUserPermissions();

  const initialPermissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : [];

  // Staff portal employees have no management permissions — redirect them before rendering anything.
  if (permissionsResult.success && initialPermissions.length === 0) {
    redirect('/portal/shifts');
  }

  // Fallback: if the permissions RPC failed, check user_roles directly.
  // This guards against RPC errors allowing portal employees through.
  if (!permissionsResult.success) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const admin = createAdminClient();
      const { data: roles } = await admin
        .from('user_roles')
        .select('roles(name)')
        .eq('user_id', user.id)
        .returns<UserRoleRow[]>();

      const roleNames = (roles ?? [])
        .map(roleNameFromRow)
        .filter((roleName): roleName is string => Boolean(roleName));

      if (roleNames.length === 0 || roleNames.every(roleName => PORTAL_ONLY_ROLES.has(roleName))) {
        redirect('/portal/shifts');
      }
    }
  }

  return (
    <AuthenticatedLayout initialPermissions={initialPermissions}>
      {children}
    </AuthenticatedLayout>
  );
}
