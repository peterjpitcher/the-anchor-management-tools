import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { getPayAgeBands, getPayBandRates } from '@/app/actions/pay-bands';
import PayBandsManager from './PayBandsManager';

export const dynamic = 'force-dynamic';

export default async function PayBandsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/');

  const bandsResult = await getPayAgeBands();
  const bands = bandsResult.success ? bandsResult.data : [];

  // Fetch rates for all bands in parallel
  const ratesResults = await Promise.all(
    bands.map(async band => [band.id, await getPayBandRates(band.id)] as const),
  );
  const ratesByBand = Object.fromEntries(
    ratesResults.map(([bandId, result]) => [bandId, result.success ? result.data : []] as const),
  );
  // A band whose rates failed to load must not read as "No rates set yet".
  const rateErrors = ratesResults.flatMap(([, result]) => (result.success ? [] : [result.error]));
  const ratesFailedBandIds = ratesResults.flatMap(([bandId, result]) => (result.success ? [] : [bandId]));

  return (
    <PayBandsManager
      canManage={canManage}
      initialBands={bands}
      initialRates={ratesByBand}
      loadError={bandsResult.success ? null : bandsResult.error}
      ratesLoadError={rateErrors.length > 0 ? rateErrors[0] : null}
      ratesFailedBandIds={ratesFailedBandIds}
    />
  );
}
