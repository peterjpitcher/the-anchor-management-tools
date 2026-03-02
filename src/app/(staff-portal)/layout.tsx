import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function StaffPortalLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">The Anchor</h1>
            <p className="text-sm text-gray-500">Staff Portal</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/portal/shifts" className="text-gray-600 hover:text-gray-900">My Shifts</a>
            <a href="/portal/leave" className="text-gray-600 hover:text-gray-900">Holiday</a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
