import { getUserPermissions } from '@/app/actions/rbac';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import AuthenticatedLayout from './AuthenticatedLayout';

export const dynamic = 'force-dynamic';

const PORTAL_ONLY_ROLES = new Set(['portal_shift_manager']);

// Role names ordered most-privileged first; used to pick the label to display.
const ROLE_PRIORITY = ['super_admin', 'manager', 'staff'] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  manager: 'Manager',
  staff: 'Staff',
};

type UserRoleRow = {
  roles: { name: string | null } | { name: string | null }[] | null;
};

function roleNameFromRow(row: UserRoleRow): string | null {
  if (Array.isArray(row.roles)) return row.roles[0]?.name ?? null;
  return row.roles?.name ?? null;
}

// Derive a display label from the user's role names, using the highest-privilege role.
// Falls back to a neutral label (never "Manager") when no known role is present.
function roleLabelFromNames(roleNames: string[]): string {
  for (const role of ROLE_PRIORITY) {
    if (roleNames.includes(role)) return ROLE_LABELS[role];
  }
  // Unknown custom role: prettify its name; otherwise default to "Staff".
  const firstRole = roleNames[0];
  if (firstRole) {
    return firstRole
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return 'Staff';
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

  // Resolve the user's role names so the shell can display their real role
  // (not a hardcoded "Manager"). Uses the admin client to read user_roles.
  const admin = createAdminClient();
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', authUser.id)
    .returns<UserRoleRow[]>();

  const roleNames = (roleRows ?? [])
    .map(roleNameFromRow)
    .filter((roleName): roleName is string => Boolean(roleName));

  const userRoleLabel = roleLabelFromNames(roleNames);

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
    <AuthenticatedLayout initialPermissions={initialPermissions} userRoleLabel={userRoleLabel}>
      {children}
    </AuthenticatedLayout>
  );
}
