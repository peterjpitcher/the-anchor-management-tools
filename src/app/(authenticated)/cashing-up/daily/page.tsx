import { createClient } from '@/lib/supabase/server';
import { DailyCashupForm } from '@/components/features/cashing-up/DailyCashupForm';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';

export default async function DailyCashupPage() {
  const supabase = await createClient();
  const { data: sites } = await supabase.from('sites').select('id, name');
  
  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
  ];

  return (
    <PageLayout title="Cashing Up" navItems={navItems} containerSize="xl">
      <DailyCashupForm sites={sites || []} />
    </PageLayout>
  );
}