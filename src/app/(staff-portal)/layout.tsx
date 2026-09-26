import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/ds';
import { StandaloneShell } from '@/components/shells/StandaloneShell';
import { PORTAL_NAV } from './portal/_shared/nav';

export const dynamic = 'force-dynamic';

async function signOut() {
  'use server';

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/auth/login');
}

export default async function StaffPortalLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <StandaloneShell
      label="Staff Portal"
      navItems={PORTAL_NAV}
      actions={
        <form action={signOut}>
          <Button type="submit" variant="secondary" size="sm">
            Sign Out
          </Button>
        </form>
      }
    >
      {children}
    </StandaloneShell>
  );
}
