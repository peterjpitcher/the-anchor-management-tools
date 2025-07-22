'use client';

import { useState, useEffect } from 'react';
import { getLoyaltyStats } from '@/app/actions/loyalty';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  ChartBarIcon, 
  UserGroupIcon, 
  GiftIcon, 
  TrophyIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CalendarDaysIcon 
} from '@heroicons/react/24/outline';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar';

interface LoyaltyStats {
  totalMembers: number;
  membersByTier: {
    member: number;
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  activeRedemptions: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
}

export default function LoyaltyAdminPage() {
  const { hasPermission } = usePermissions();
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const result = await getLoyaltyStats();
      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setStats(result.data);
      }
    } catch (err) {
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('loyalty', 'view')) {
    return (
      <Page title="Loyalty Program Dashboard">
        <Card>
          <Alert variant="error" 
            title="Access Denied" 
            description="You don't have permission to view this page." 
          />
        </Card>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="Loyalty Program Dashboard">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading loyalty statistics...</p>
          </div>
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Loyalty Program Dashboard">
        <Card>
          <Alert variant="error" title="Error" description={error} />
        </Card>
      </Page>
    );
  }

  const redemptionRate = stats ? 
    ((stats.totalPointsRedeemed / stats.totalPointsIssued) * 100).toFixed(1) : '0';

  const tierColors = {
    member: 'bg-gray-500',
    bronze: 'bg-amber-600',
    silver: 'bg-gray-400',
    gold: 'bg-yellow-500',
    platinum: 'bg-purple-600'
  };

  return (
    <Page
      title="Loyalty Program Dashboard"
      description="Monitor and manage The Anchor VIP Club"
      actions={
        <div className="flex flex-wrap gap-2">
          <LinkButton
            href="/loyalty/admin/rewards"
            variant="secondary"
            size="sm"
          >
            <GiftIcon className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Rewards</span>
            <span className="sm:hidden">Rewards</span>
          </LinkButton>
          <LinkButton
            href="/loyalty/admin/achievements"
            variant="secondary"
            size="sm"
          >
            <TrophyIcon className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Achievements</span>
            <span className="sm:hidden">Achieve</span>
          </LinkButton>
          <LinkButton
            href="/loyalty/admin/challenges"
            variant="secondary"
            size="sm"
          >
            <CalendarDaysIcon className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Challenges</span>
            <span className="sm:hidden">Challenge</span>
          </LinkButton>
          <LinkButton
            href="/loyalty/analytics"
            variant="secondary"
            size="sm"
          >
            <ChartBarIcon className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
            <span className="sm:hidden">Analytics</span>
          </LinkButton>
        </div>
      }
    >

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total Members" 
          value={stats?.totalMembers || 0} 
          icon={<UserGroupIcon />}
        />
        <Stat label="Points Issued" 
          value={stats?.totalPointsIssued.toLocaleString() || '0'}
          icon={<ChartBarIcon />}
        />
        <Stat label="Active Redemptions" 
          value={stats?.activeRedemptions || 0}
          icon={<GiftIcon />}
        />
        <Stat label="Redemption Rate" 
          value={`${redemptionRate}%`}
          icon={<TrophyIcon />}
        />
      </div>

      {/* Tier Distribution */}
      <Section title="Member Distribution by Tier">
        <Card>
          <div className="space-y-4">
            {stats && Object.entries(stats.membersByTier).map(([tier, count]) => {
              const percentage = stats.totalMembers > 0 ? (count / stats.totalMembers) * 100 : 0;
              const tierVariants = {
                member: 'default',
                bronze: 'warning',
                silver: 'info',
                gold: 'warning',
                platinum: 'primary'
              };
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 capitalize">{tier}</span>
                    <span className="text-sm text-gray-600">{count} members ({percentage.toFixed(1)}%)</span>
                  </div>
                  <ProgressBar 
                    value={percentage} 
                    variant={tierVariants[tier as keyof typeof tierVariants] as any}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/loyalty/admin/enroll"
              className="relative rounded-lg border border-gray-300 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
            >
              <div className="flex-shrink-0">
                <UserGroupIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="absolute inset-0" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">Enroll Customer</p>
                <p className="text-sm text-gray-500">Add existing customer to VIP</p>
              </div>
            </Link>

            <Link
              href="/loyalty/admin/import"
              className="relative rounded-lg border border-gray-300 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
            >
              <div className="flex-shrink-0">
                <ArrowUpIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="absolute inset-0" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">Bulk Import</p>
                <p className="text-sm text-gray-500">Import members from CSV</p>
              </div>
            </Link>

            <Link
              href="/loyalty/admin/export"
              className="relative rounded-lg border border-gray-300 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
            >
              <div className="flex-shrink-0">
                <ArrowDownIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="absolute inset-0" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">Export Data</p>
                <p className="text-sm text-gray-500">Download member data</p>
              </div>
            </Link>

            <Link
              href="/loyalty/admin/campaigns"
              className="relative rounded-lg border border-gray-300 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
            >
              <div className="flex-shrink-0">
                <ChartBarIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="absolute inset-0" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">Campaigns</p>
                <p className="text-sm text-gray-500">Bonus point events</p>
              </div>
            </Link>

            <Link
              href="/loyalty/training"
              className="relative rounded-lg border border-gray-300 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
            >
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <span className="absolute inset-0" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">Staff Training</p>
                <p className="text-sm text-gray-500">Learn the system</p>
              </div>
            </Link>
          </div>
        </Card>
      </Section>
    </Page>
  );
}