import { createClient } from '@/lib/supabase/server';
import { DailyCashupForm } from '@/components/features/cashing-up/DailyCashupForm';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { CashingUpService } from '@/services/cashing-up.service'; // Import CashingUpService

export default async function DailyCashupPage(props: { searchParams: Promise<{ date?: string; siteId?: string }> }) {
  const searchParams = await props.searchParams;
  const sessionDateParam = searchParams.date;
  const siteIdParam = searchParams.siteId;

  const supabase = await createClient();
  let defaultSiteId: string | undefined;

  const navItems = [ // Moved declaration here
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
    { label: 'Insights', href: '/cashing-up/insights' },
    { label: 'Import History', href: '/cashing-up/import' },
  ];

  // Determine siteId
  let siteId = siteIdParam;
  if (!siteId) {
    const { data: defaultSite, error: defaultSiteError } = await supabase.from('sites').select('id').limit(1).single();
    if (defaultSiteError || !defaultSite) {
      return (
        <PageLayout title="Cashing Up" navItems={navItems} containerSize="xl" error="No site configured or an error occurred.">
          <div className="p-4 text-center text-gray-500">Please configure a site in the database.</div>
        </PageLayout>
      );
    }
    siteId = defaultSite.id;
  }

  // Fetch site details for the form
  const { data: siteDetails, error: siteDetailsError } = await supabase.from('sites').select('id, name').eq('id', siteId).single();



  if (siteDetailsError || !siteDetails) {
    return (
      <PageLayout title="Cashing Up" navItems={navItems} containerSize="xl" error="Site not found or an error occurred.">
        <div className="p-4 text-center text-gray-500">The selected site could not be loaded.</div>
      </PageLayout>
    );
  }

  let initialSessionData = null;
  const sessionDate = sessionDateParam; // Date from query param

  if (sessionDate && siteId) {
    try {
      initialSessionData = await CashingUpService.getSessionByDateAndSite(supabase, siteId, sessionDate);
      console.log('Server Page: Fetched session data:', initialSessionData ? { id: initialSessionData.id, status: initialSessionData.status } : 'None');
    } catch (error: any) {
      console.error('Error fetching session data:', error);
      // Continue without session data, will show empty form
    }
  }

  return (
    <PageLayout title="Cashing Up" navItems={navItems}>
      <DailyCashupForm
        site={siteDetails}
        sessionDate={sessionDate || new Date().toISOString().split('T')[0]} // Default to today if not provided
        initialSessionData={initialSessionData}
      />
    </PageLayout>
  );
}