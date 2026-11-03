import Link from 'next/link';
import { redirect } from 'next/navigation';
import { checkUserPermission } from '@/app/actions/rbac';
import {
  getTeamReliabilityLeaderboard,
  RELIABILITY_LEADERBOARD_LOAD_ERROR,
  type TeamReliabilityRow,
} from '@/services/employee-reliability';
import { hasNoShiftSignals, type ReliabilityScoreBreakdown } from '@/lib/employee-reliability-scoring';
import {
  Alert,
  Badge,
  Card,
  Empty,
  LinkButton,
  PageLayout,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { EMPLOYEES_NAV } from '../_shared/nav';
import {
  employmentStatusLabel,
  RELIABILITY_LOW_SAMPLE_TONE,
  RELIABILITY_NO_SHIFTS_LABEL,
  RELIABILITY_NO_SHIFTS_TONE,
  reliabilityScoreTone,
} from '../_shared/status-ui';
import { normalizeReliabilitySort, reliabilitySortHref } from './_shared/sort';
import { ReliabilitySortHead, ReliabilitySortSelect } from './_components/ReliabilitySortControls';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value}%`;
}

/**
 * The score badge, or a neutral "No shifts yet" when there is nothing to score. With no shifts the
 * formula still gives 45, which used to show in red as if the person were unreliable.
 */
function ScoreBadge({ score }: { score: ReliabilityScoreBreakdown }): React.JSX.Element {
  if (hasNoShiftSignals(score)) {
    return <Badge tone={RELIABILITY_NO_SHIFTS_TONE}>{RELIABILITY_NO_SHIFTS_LABEL}</Badge>;
  }
  return <Badge tone={reliabilityScoreTone(score.score)}>{score.score}</Badge>;
}

/** Low sample only means something when there is a sample; no shifts at all says so on its own. */
function showsLowSample(score: ReliabilityScoreBreakdown): boolean {
  return score.isLowSample && !hasNoShiftSignals(score);
}

export default async function EmployeeReliabilityLeaderboardPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('employees', 'view');
  if (!canView) redirect('/unauthorized');

  const params = await searchParams;
  const includeFormer = params.includeFormer === '1';
  const sortBy = normalizeReliabilitySort(params.sort);
  // The same title and subtitle whether or not the leaderboard loads.
  const layoutProps = {
    title: 'Employees',
    subtitle: 'Reliability: shift reliability over the last 90 days',
    navItems: EMPLOYEES_NAV,
  };

  // The Include Former filter sits directly above the leaderboard it filters, never in the header.
  // It keeps the sort order: the link used to drop it, so the list jumped back to Score.
  const scopeFilter = (
    <LinkButton
      href={reliabilitySortHref(sortBy, !includeFormer)}
      variant="secondary"
      size="sm"
    >
      {includeFormer ? 'Active Only' : 'Include Former'}
    </LinkButton>
  );

  // A failed read keeps the header and says so; it is never shown as an empty leaderboard.
  let rows: TeamReliabilityRow[];
  try {
    rows = await getTeamReliabilityLeaderboard({ includeFormer, sortBy });
  } catch (error) {
    // The service logs its own database errors; anything else is logged here.
    if (!(error instanceof Error && error.message === RELIABILITY_LEADERBOARD_LOAD_ERROR)) {
      console.error('[employees/reliability] leaderboard failed to load', error);
    }
    return (
      <PageLayout {...layoutProps}>
        <div className="flex flex-wrap items-end gap-3">{scopeFilter}</div>
        <Alert tone="danger" title="Could not load the leaderboard">
          {RELIABILITY_LEADERBOARD_LOAD_ERROR}
        </Alert>
      </PageLayout>
    );
  }
  const rankedCount = rows.filter(row => !row.recent.isLowSample).length;
  // Someone with no shifts at all is shown as "No shifts yet", not "Low sample", so the two are
  // counted apart and the stats match the badges on the rows.
  const noShiftsCount = rows.filter(row => hasNoShiftSignals(row.recent)).length;

  return (
    <PageLayout {...layoutProps}>
      <StatGrid columns={5}>
        <Stat label="Ranked" value={rankedCount} />
        <Stat label="Low sample" value={rows.length - rankedCount - noShiftsCount} />
        <Stat label={RELIABILITY_NO_SHIFTS_LABEL} value={noShiftsCount} />
        <Stat
          label="Couldn't Work"
          value={rows.reduce((sum, row) => sum + row.recent.counts.couldntWork, 0)}
        />
        <Stat
          label="Rejected shifts"
          value={rows.reduce((sum, row) => sum + row.recent.counts.rejections, 0)}
        />
      </StatGrid>

      {/* Filters directly above the list they filter. Phones also get the sort order here, as
          they have no table headers to sort from. */}
      <div className="flex flex-wrap items-end gap-3">
        {rows.length > 0 && (
          <div className="shell:hidden">
            <ReliabilitySortSelect activeSort={sortBy} includeFormer={includeFormer} />
          </div>
        )}
        {scopeFilter}
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty
            size="sm"
            title={includeFormer ? 'No employees yet' : 'No employees match these filters'}
            description={
              includeFormer
                ? 'Employees appear here once they are added.'
                : 'Include former employees to see everyone.'
            }
          />
        </Card>
      ) : (
        <>

          <Card padding="none" className="shell:hidden">
            <ul className="divide-y divide-border">
              {rows.map(row => (
                <li key={row.employeeId} className="px-pad-card py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/employees/${row.employeeId}`} className="font-semibold text-primary hover:underline">
                        {row.employeeName}
                      </Link>
                      <div className="text-xs text-text-muted">{row.jobTitle || 'No role'} · {employmentStatusLabel(row.status)}</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <span className="text-xs text-text-muted">#{row.rank ?? '--'}</span>
                      <ScoreBadge score={row.recent} />
                    </div>
                  </div>
                  {showsLowSample(row.recent) && (
                    <div className="mt-1.5"><Badge tone={RELIABILITY_LOW_SAMPLE_TONE}>Low sample</Badge></div>
                  )}
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Manual accept</dt>
                      <dd className="text-text">{formatPercent(row.recent.rates.manualAcceptRate)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Reject rate</dt>
                      <dd className="text-text">{formatPercent(row.recent.rates.rejectionRate)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Couldn&apos;t Work</dt>
                      <dd className="text-text">{row.recent.counts.couldntWork}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Late holidays</dt>
                      <dd className="text-text">{row.recent.counts.lateHolidays}</dd>
                    </div>
                    <div className="col-span-2 flex justify-between gap-2">
                      <dt className="text-text-muted">Sample</dt>
                      <dd className="text-text">{row.recent.counts.eligibleShiftSignals} signals</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </Card>

          {/* Desktop: the leaderboard table, sorted from its column headers */}
          <Card padding="none" className="hidden shell:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Employee</TableHead>
                  <ReliabilitySortHead sort="score" activeSort={sortBy} includeFormer={includeFormer} />
                  <ReliabilitySortHead sort="manual_accept_rate" activeSort={sortBy} includeFormer={includeFormer} />
                  <ReliabilitySortHead sort="rejection_rate" activeSort={sortBy} includeFormer={includeFormer} />
                  <ReliabilitySortHead sort="couldnt_work" activeSort={sortBy} includeFormer={includeFormer} />
                  <ReliabilitySortHead sort="late_holidays" activeSort={sortBy} includeFormer={includeFormer} />
                  <TableHead>Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="text-text-muted">{row.rank ?? '--'}</TableCell>
                    <TableCell className="whitespace-normal">
                      <Link href={`/employees/${row.employeeId}`} className="font-semibold text-primary hover:underline">
                        {row.employeeName}
                      </Link>
                      <div className="text-xs text-text-muted">
                        {row.jobTitle || 'No role'} · {employmentStatusLabel(row.status)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ScoreBadge score={row.recent} />
                        {showsLowSample(row.recent) && <Badge tone={RELIABILITY_LOW_SAMPLE_TONE}>Low sample</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{formatPercent(row.recent.rates.manualAcceptRate)}</TableCell>
                    <TableCell>{formatPercent(row.recent.rates.rejectionRate)}</TableCell>
                    <TableCell>{row.recent.counts.couldntWork}</TableCell>
                    <TableCell>{row.recent.counts.lateHolidays}</TableCell>
                    <TableCell className="text-text-muted">
                      {row.recent.counts.eligibleShiftSignals} signals
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </PageLayout>
  );
}
