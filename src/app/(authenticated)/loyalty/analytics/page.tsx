'use client';

import { useState, useEffect } from 'react';
import { getLoyaltyAnalytics, getMemberEngagementMetrics } from '@/app/actions/loyalty-analytics';
import { usePermissions } from '@/contexts/PermissionContext';
import { LoyaltySettingsService } from '@/lib/config/loyalty-settings';
import { 
  ChartBarIcon,
  ArrowTrendingUpIcon,
  UserGroupIcon,
  GiftIcon,
  CalendarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ClockIcon,
  CurrencyPoundIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Select } from '@/components/ui-v2/forms/Select';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Stat } from '@/components/ui-v2/display/Stat';
import { Badge } from '@/components/ui-v2/display/Badge';

interface AnalyticsData {
  // Member metrics
  totalMembers: number;
  newMembersThisWeek: number;
  memberGrowthRate: number;
  
  // Tier distribution
  tierDistribution: {
    member: number;
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  
  // Engagement metrics
  activeMembers: number; // Visited in last 30 days
  averageVisitsPerMember: number;
  checkInRate: number; // % of bookings that check in
  
  // Points metrics
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  redemptionRate: number;
  averagePointsPerMember: number;
  
  // Reward metrics
  mostPopularRewards: Array<{
    name: string;
    redemptions: number;
    category: string;
  }>;
  
  // Time-based metrics
  checkInsByDayOfWeek: Record<string, number>;
  checkInsByHour: Record<string, number>;
  monthlyTrends: Array<{
    month: string;
    members: number;
    checkIns: number;
    points: number;
  }>;
}

interface EngagementData {
  engagementCohorts: {
    veryActive: number;
    active: number;
    occasional: number;
    dormant: number;
    new: number;
  };
  visitFrequency: Record<string, number>;
  pointsDistribution: Record<string, number>;
  totalMembers: number;
}

export default function LoyaltyAnalyticsPage() {
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [programOperational, setProgramOperational] = useState(false);

  useEffect(() => {
    // Check operational status (but always allow viewing analytics)
    const operational = LoyaltySettingsService.isOperationalEnabled();
    setProgramOperational(operational);
    
    // Always load analytics for configuration purposes
    loadAnalytics();

    // Listen for settings changes
    const handleSettingsChange = (event: CustomEvent) => {
      setProgramOperational(event.detail.operationalEnabled);
    };

    window.addEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    return () => {
      window.removeEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    };
  }, [dateRange]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // Fetch real analytics data
      const result = await getLoyaltyAnalytics({ range: dateRange });
      
      if (result.error) {
        console.error('Error loading analytics:', result.error);
        return;
      }
      
      if (result.data) {
        // Map the data to the expected format
        const analytics: AnalyticsData = {
          totalMembers: result.data.totalMembers,
          newMembersThisWeek: result.data.newMembersThisWeek,
          memberGrowthRate: result.data.memberGrowthRate,
          tierDistribution: {
            member: result.data.tierDistribution.member || 0,
            bronze: result.data.tierDistribution.bronze || 0,
            silver: result.data.tierDistribution.silver || 0,
            gold: result.data.tierDistribution.gold || 0,
            platinum: result.data.tierDistribution.platinum || 0
          },
          activeMembers: result.data.activeMembers,
          averageVisitsPerMember: result.data.averageVisitsPerMember,
          checkInRate: result.data.checkInRate,
          totalPointsIssued: result.data.totalPointsIssued,
          totalPointsRedeemed: result.data.totalPointsRedeemed,
          redemptionRate: result.data.redemptionRate,
          averagePointsPerMember: result.data.averagePointsPerMember,
          mostPopularRewards: result.data.mostPopularRewards,
          checkInsByDayOfWeek: result.data.checkInsByDayOfWeek,
          checkInsByHour: result.data.checkInsByHour,
          monthlyTrends: result.data.monthlyTrends
        };
        
        setAnalyticsData(analytics);
        
        // Load engagement metrics
        const engagementResult = await getMemberEngagementMetrics();
        if (engagementResult.data) {
          setEngagementData(engagementResult.data);
        }
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('loyalty', 'view')) {
    return (
      <Page title="Loyalty Analytics" error="You don't have permission to view analytics." />
    );
  }

  if (!analyticsData) {
    return (
      <Page 
        title="Loyalty Analytics"
        description="Track performance and member engagement for The Anchor VIP Club"
        error="No analytics data available."
      />
    );
  }

  const stats = [
    {
      name: 'Total Members',
      value: analyticsData.totalMembers.toLocaleString(),
      change: `+${analyticsData.newMembersThisWeek}`,
      changeType: 'increase' as const,
      icon: <UserGroupIcon />,
      description: 'this week'
    },
    {
      name: 'Active Members',
      value: analyticsData.activeMembers.toLocaleString(),
      change: `${((analyticsData.activeMembers / analyticsData.totalMembers) * 100).toFixed(1)}%`,
      changeType: 'neutral' as const,
      icon: <ArrowTrendingUpIcon />,
      description: 'engagement rate'
    },
    {
      name: 'Points Redeemed',
      value: `${(analyticsData.redemptionRate).toFixed(1)}%`,
      change: `${analyticsData.totalPointsRedeemed.toLocaleString()} pts`,
      changeType: 'increase' as const,
      icon: <GiftIcon />,
      description: 'total redeemed'
    },
    {
      name: 'Check-in Rate',
      value: `${analyticsData.checkInRate}%`,
      change: `${analyticsData.averageVisitsPerMember.toFixed(1)} avg`,
      changeType: 'increase' as const,
      icon: <ChartBarIcon />,
      description: 'visits per member'
    }
  ];

  return (
    <Page
      title="Loyalty Analytics"
      description="Track performance and member engagement for The Anchor VIP Club"
      loading={loading}
      actions={
        <div className="flex gap-3">
          <Select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            options={[
              { value: 'week', label: 'Last 7 days' },
              { value: 'month', label: 'Last 30 days' },
              { value: 'quarter', label: 'Last 3 months' },
              { value: 'year', label: 'Last 12 months' }
            ]}
          />
          <LinkButton href="/loyalty/admin" variant="secondary">
            Back to Dashboard
          </LinkButton>
        </div>
      }
    >
      {/* Operational Status Banner */}
      {!programOperational && (
        <Alert
          variant="warning"
          title="Viewing Historical Data"
          className="mb-6"
        >
          The loyalty program is not operational. Analytics show historical data. New points won't be earned until you
          <Link href="/settings/loyalty" className="ml-1 text-yellow-900 underline">enable operations</Link>.
        </Alert>
      )}

      {/* Key Metrics */}
      <Section className="mb-6">
        <div className="grid grid-cols-1 gap-3 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Stat key={stat.name}
              label={stat.name}
              value={stat.value}
              change={stat.change}
              changeType={stat.changeType}
              icon={stat.icon}
              description={stat.description}
            />
          ))}
        </div>
      </Section>

      {/* Tier Distribution */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Member Distribution by Tier</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          {Object.entries(analyticsData.tierDistribution).map(([tier, count]) => {
            const percentage = (count / analyticsData.totalMembers) * 100;
            const tierColors = {
              member: 'bg-gray-500',
              bronze: 'bg-amber-600',
              silver: 'bg-gray-400',
              gold: 'bg-yellow-500',
              platinum: 'bg-purple-600'
            };
            
            return (
              <div key={tier}>
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize font-medium">{tier}</span>
                  <span className="text-gray-500">{count} ({percentage.toFixed(1)}%)</span>
                </div>
                <div className="mt-1 relative">
                  <div className="overflow-hidden h-2 text-xs flex rounded bg-gray-200">
                    <div 
                      style={{ width: `${percentage}%` }}
                      className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center ${tierColors[tier as keyof typeof tierColors]}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Popular Times and Rewards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
        {/* Popular Check-in Times */}
        <Card>
          <CardHeader>
            <CardTitle>Peak Check-in Times</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium text-gray-500">
              <span>Day</span>
              <span>Check-ins</span>
            </div>
            {Object.entries(analyticsData.checkInsByDayOfWeek)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([day, count]) => {
                const maxCount = Math.max(...Object.values(analyticsData.checkInsByDayOfWeek));
                return (
                  <div key={day} className="flex items-center justify-between">
                    <span className="text-sm">{day}</span>
                    <div className="flex items-center">
                      <div className="w-32 bg-gray-200 rounded-full h-2 mr-3">
                        <div 
                          className="bg-amber-600 h-2 rounded-full" 
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-12 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Most Popular Rewards */}
        <Card>
          <CardHeader>
            <CardTitle>Most Redeemed Rewards</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {analyticsData.mostPopularRewards.map((reward, index) => (
              <div key={reward.name} className="flex items-center justify-between">
                <div className="flex items-center">
                  <span className="text-2xl font-bold text-gray-400 w-8">#{index + 1}</span>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900">{reward.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{reward.category}</p>
                  </div>
                </div>
                <span className="text-sm font-medium">{reward.redemptions} redemptions</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Member Engagement Analysis */}
      {engagementData && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Member Engagement Analysis</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {/* Engagement Cohorts */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Activity Levels</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Very Active (7d)</span>
                  <span className="text-sm font-medium">{engagementData.engagementCohorts.veryActive}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Active (30d)</span>
                  <span className="text-sm font-medium">{engagementData.engagementCohorts.active}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Occasional (90d)</span>
                  <span className="text-sm font-medium">{engagementData.engagementCohorts.occasional}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Dormant (90d+)</span>
                  <span className="text-sm font-medium">{engagementData.engagementCohorts.dormant}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">New Members</span>
                  <span className="text-sm font-medium">{engagementData.engagementCohorts.new}</span>
                </div>
              </div>
            </div>
            
            {/* Visit Frequency */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Visit Frequency</h3>
              <div className="space-y-2">
                {Object.entries(engagementData.visitFrequency).map(([range, count]) => (
                  <div key={range} className="flex justify-between items-center">
                    <span className="text-sm">{range} visits</span>
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Points Balance */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Points Balance</h3>
              <div className="space-y-2">
                {Object.entries(engagementData.pointsDistribution).map(([range, count]) => (
                  <div key={range} className="flex justify-between items-center">
                    <span className="text-sm">{range} points</span>
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Monthly Trends Chart (Simplified) */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Growth Trends</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <DataTable
            data={analyticsData.monthlyTrends}
            getRowKey={(item) => item.month}
            columns={[
              { key: 'month', header: 'Month', cell: (row) => row.month },
              { key: 'members', header: 'Total Members', cell: (row) => row.members.toLocaleString() },
              { key: 'checkIns', header: 'Check-ins', cell: (row) => row.checkIns.toLocaleString() },
              { key: 'points', header: 'Points Issued', cell: (row) => row.points.toLocaleString(), className: 'hidden sm:table-cell' },
              {
                key: 'growth',
                header: 'Growth',
                cell: (row) => {
                  const currentIndex = analyticsData.monthlyTrends.findIndex(trend => trend.month === row.month);
                  const previousMonth = currentIndex > 0 ? analyticsData.monthlyTrends[currentIndex - 1] : null;
                  const growth = previousMonth
                    ? ((row.members - previousMonth.members) / previousMonth.members * 100).toFixed(1)
                    : '0';
                  return (
                    <span className={`flex items-center ${
                      parseFloat(growth) > 0 ? 'text-green-600' :
                      parseFloat(growth) < 0 ? 'text-red-600' :
                      'text-gray-500'
                    }`}>
                      {parseFloat(growth) > 0 ? (
                        <ArrowUpIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                      ) : parseFloat(growth) < 0 ? (
                        <ArrowDownIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                      ) : null}
                      {growth}%
                    </span>
                  );
                }
              }
            ]}
          />
        </div>
      </Card>

      {/* Quick Actions */}
      <Section className="mt-6">
        <Card padding="lg" variant="bordered">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <Card 
              interactive
              onClick={() => window.location.href = '/loyalty/admin/members'}
              className="hover:shadow-md transition-shadow"
            >
              <div className="flex items-center">
                <UserGroupIcon className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm sm:text-base">View All Members</p>
                  <p className="text-xs sm:text-sm text-gray-500">Browse and manage</p>
                </div>
              </div>
            </Card>
            
            <Card 
              interactive
              onClick={() => window.location.href = '/messages/bulk'}
              className="hover:shadow-md transition-shadow"
            >
              <div className="flex items-center">
                <ArrowTrendingUpIcon className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm sm:text-base">Send Campaign</p>
                  <p className="text-xs sm:text-sm text-gray-500">Target VIP members</p>
                </div>
              </div>
            </Card>
            
            <Card 
              interactive
              onClick={() => window.location.href = '/loyalty/admin/rewards'}
              className="hover:shadow-md transition-shadow"
            >
              <div className="flex items-center">
                <GiftIcon className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm sm:text-base">Manage Rewards</p>
                  <p className="text-xs sm:text-sm text-gray-500">Update catalog</p>
                </div>
              </div>
            </Card>
          </div>
        </Card>
      </Section>
    </Page>
  );
}