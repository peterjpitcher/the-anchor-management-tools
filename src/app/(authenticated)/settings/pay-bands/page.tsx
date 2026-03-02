import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { getPayAgeBands, getPayBandRates } from '@/app/actions/pay-bands';
import PayBandsManager from './PayBandsManager';

export const dynamic = 'force-dynamic';

export default async function PayBandsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/');

  const bandsResult = await getPayAgeBands();
  const bands = bandsResult.success ? bandsResult.data : [];

  // Fetch rates for all bands in parallel
  const ratesEntries = await Promise.all(
    bands.map(async band => {
      const result = await getPayBandRates(band.id);
      return [band.id, result.success ? result.data : []] as const;
    }),
  );
  const ratesByBand = Object.fromEntries(ratesEntries);

  return (
    <PageLayout
      title="Pay Bands"
      subtitle="Age-based pay band definitions and effective-dated hourly rates"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section
        title="Age Bands &amp; Rates"
        description="Rates are append-only. Adding a new rate does not change historical payroll calculations."
      >
        <Card>
          <PayBandsManager
            canManage={canManage}
            initialBands={bands}
            initialRates={ratesByBand}
          />
        </Card>
      </Section>
    </PageLayout>
  );
}
