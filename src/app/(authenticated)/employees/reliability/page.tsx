import Link from 'next/link';
import { redirect } from 'next/navigation';
import { checkUserPermission } from '@/app/actions/rbac';
import {
  getTeamReliabilityLeaderboard,
  type TeamReliabilitySort,
} from '@/services/employee-reliability';
import { Badge, Card, CardBody, PageHeader } from '@/ds';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const SORTS: TeamReliabilitySort[] = [
  'score',
  'manual_accept_rate',
  'rejection_rate',
  'couldnt_work',
  'late_holidays',
];

function normalizeSort(value: string | string[] | undefined): TeamReliabilitySort {
  const raw = Array.isArray(value) ? value[0] : value;
  return SORTS.includes(raw as TeamReliabilitySort) ? raw as TeamReliabilitySort : 'score';
}

function sortHref(sort: TeamReliabilitySort, includeFormer: boolean): string {
  const params = new URLSearchParams({ sort });
  if (includeFormer) params.set('includeFormer', '1');
  return `/employees/reliability?${params.toString()}`;
}

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value}%`;
}

function scoreTone(score: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  if (score > 0) return 'danger';
  return 'neutral';
}

function SortLink({
  sort,
  active,
  includeFormer,
  children,
}: {
  sort: TeamReliabilitySort;
  active: TeamReliabilitySort;
  includeFormer: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={sortHref(sort, includeFormer)}
      className={active === sort ? 'font-semibold text-primary' : 'font-medium text-text-muted hover:text-primary'}
    >
      {children}
    </Link>
  );
}

export default async function EmployeeReliabilityLeaderboardPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('employees', 'view');
  if (!canView) redirect('/unauthorized');

  const params = await searchParams;
  const includeFormer = params.includeFormer === '1';
  const sortBy = normalizeSort(params.sort);
  const rows = await getTeamReliabilityLeaderboard({ includeFormer, sortBy });
  const rankedCount = rows.filter(row => !row.recent.isLowSample).length;

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Employees', href: '/employees' },
          { label: 'Reliability' },
        ]}
        title="Business Reliability"
        subtitle={`${rankedCount} ranked staff · last 90 days`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={includeFormer ? '/employees/reliability' : '/employees/reliability?includeFormer=1'}
              className="inline-flex h-[var(--spacing-btn-h-sm)] items-center justify-center rounded-[7px] border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text hover:bg-surface-hover"
            >
              {includeFormer ? 'Active only' : 'Include former'}
            </Link>
            <Link
              href="/employees"
              className="inline-flex h-[var(--spacing-btn-h-sm)] items-center justify-center rounded-[7px] border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text hover:bg-surface-hover"
            >
              Back to employees
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-xs text-text-muted">Ranked</p>
            <p className="mt-1 text-2xl font-semibold text-text-strong">{rankedCount}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-text-muted">Low sample</p>
            <p className="mt-1 text-2xl font-semibold text-text-strong">{rows.length - rankedCount}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-text-muted">Couldn&apos;t Work</p>
            <p className="mt-1 text-2xl font-semibold text-text-strong">
              {rows.reduce((sum, row) => sum + row.recent.counts.couldntWork, 0)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-text-muted">Rejected shifts</p>
            <p className="mt-1 text-2xl font-semibold text-text-strong">
              {rows.reduce((sum, row) => sum + row.recent.counts.rejections, 0)}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-text-muted">Sort:</span>
            <SortLink sort="score" active={sortBy} includeFormer={includeFormer}>Score</SortLink>
            <SortLink sort="manual_accept_rate" active={sortBy} includeFormer={includeFormer}>Manual accept</SortLink>
            <SortLink sort="rejection_rate" active={sortBy} includeFormer={includeFormer}>Reject rate</SortLink>
            <SortLink sort="couldnt_work" active={sortBy} includeFormer={includeFormer}>Couldn&apos;t Work</SortLink>
            <SortLink sort="late_holidays" active={sortBy} includeFormer={includeFormer}>Late holidays</SortLink>
          </div>
        )}
        {rows.map(row => (
          <div key={row.employeeId} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/employees/${row.employeeId}`} className="font-semibold text-primary hover:underline">
                  {row.employeeName}
                </Link>
                <div className="text-xs text-text-muted">{row.jobTitle || 'No role'} · {row.status}</div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <span className="text-xs text-text-muted">#{row.rank ?? '--'}</span>
                <Badge tone={scoreTone(row.recent.score)}>{row.recent.score}</Badge>
              </div>
            </div>
            {row.recent.isLowSample && (
              <div className="mt-1.5"><Badge tone="warning">Low sample</Badge></div>
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
          </div>
        ))}
        {rows.length === 0 && (
          <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted">
            No employees found for this view.
          </p>
        )}
      </div>

      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Rank</th>
                <th scope="col" className="px-4 py-3">Employee</th>
                <th scope="col" className="px-4 py-3">
                  <SortLink sort="score" active={sortBy} includeFormer={includeFormer}>Score</SortLink>
                </th>
                <th scope="col" className="px-4 py-3">
                  <SortLink sort="manual_accept_rate" active={sortBy} includeFormer={includeFormer}>Manual accept</SortLink>
                </th>
                <th scope="col" className="px-4 py-3">
                  <SortLink sort="rejection_rate" active={sortBy} includeFormer={includeFormer}>Reject rate</SortLink>
                </th>
                <th scope="col" className="px-4 py-3">
                  <SortLink sort="couldnt_work" active={sortBy} includeFormer={includeFormer}>Couldn&apos;t Work</SortLink>
                </th>
                <th scope="col" className="px-4 py-3">
                  <SortLink sort="late_holidays" active={sortBy} includeFormer={includeFormer}>Late holidays</SortLink>
                </th>
                <th scope="col" className="px-4 py-3">Sample</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(row => (
                <tr key={row.employeeId} className="bg-surface">
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                    {row.rank ?? '--'}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/employees/${row.employeeId}`} className="font-semibold text-primary hover:underline">
                      {row.employeeName}
                    </Link>
                    <div className="text-xs text-text-muted">
                      {row.jobTitle || 'No role'} · {row.status}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={scoreTone(row.recent.score)}>{row.recent.score}</Badge>
                      {row.recent.isLowSample && <Badge tone="warning">Low sample</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{formatPercent(row.recent.rates.manualAcceptRate)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatPercent(row.recent.rates.rejectionRate)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.recent.counts.couldntWork}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.recent.counts.lateHolidays}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                    {row.recent.counts.eligibleShiftSignals} signals
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                    No employees found for this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
