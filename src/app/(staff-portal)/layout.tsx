import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/ds';

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
    <div className="staff-portal-shell min-h-screen bg-bg">
      <header className="bg-surface border-b border-border sticky top-0 z-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4">
          <div>
            <h1 className="text-lg font-semibold text-text-strong">The Anchor</h1>
            <p className="text-sm text-text-muted">Staff Portal</p>
          </div>
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 text-sm scrollbar-hide sm:mx-0 sm:gap-4 sm:overflow-visible sm:px-0">
            <nav className="flex items-center gap-2 sm:gap-4">
              <a href="/portal/shifts" className="touch-target inline-flex shrink-0 items-center justify-center rounded-lg px-2.5 py-2 text-text-muted hover:text-text sm:rounded-none sm:px-0 sm:py-0">My Shifts</a>
              <a href="/portal/leave" className="touch-target inline-flex shrink-0 items-center justify-center rounded-lg px-2.5 py-2 text-text-muted hover:text-text sm:rounded-none sm:px-0 sm:py-0">Holiday</a>
            </nav>
            <form action={signOut} className="shrink-0">
              {/* Inset focus ring: this row scrolls sideways on phones, which would clip an outer ring. */}
              <Button type="submit" variant="secondary" className="focus-visible:shadow-ring-inset">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5 sm:py-6">
        {children}
      </main>
    </div>
  );
}
