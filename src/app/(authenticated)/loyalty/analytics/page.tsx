'use client';

import { useState, useEffect } from 'react';
import { getLoyaltyStats } from '@/app/actions/loyalty';
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

export default function LoyaltyAnalyticsPage() {
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
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
      // In production, this would fetch real analytics data
      // For now, we'll use mock data
      const mockAnalytics: AnalyticsData = {
        totalMembers: 1247,
        newMembersThisWeek: 23,
        memberGrowthRate: 12.5,
        tierDistribution: {
          member: 820,
          bronze: 285,
          silver: 98,
          gold: 37,
          platinum: 7
        },
        activeMembers: 892,
        averageVisitsPerMember: 3.2,
        checkInRate: 78.5,
        totalPointsIssued: 125400,
        totalPointsRedeemed: 48600,
        redemptionRate: 38.7,
        averagePointsPerMember: 101,
        mostPopularRewards: [
          { name: 'Free Pint', redemptions: 234, category: 'drinks' },
          { name: 'Nachos', redemptions: 156, category: 'snacks' },
          { name: 'Dessert of the Day', redemptions: 89, category: 'desserts' }
        ],
        checkInsByDayOfWeek: {
          'Monday': 120,
          'Tuesday': 145,
          'Wednesday': 189,
          'Thursday': 210,
          'Friday': 342,
          'Saturday': 298,
          'Sunday': 156
        },
        checkInsByHour: {
          '17': 45,
          '18': 89,
          '19': 156,
          '20': 210,
          '21': 178,
          '22': 92
        },
        monthlyTrends: [
          { month: 'Jan', members: 980, checkIns: 2450, points: 12250 },
          { month: 'Feb', members: 1050, checkIns: 2680, points: 13400 },
          { month: 'Mar', members: 1120, checkIns: 2890, points: 14450 },
          { month: 'Apr', members: 1247, checkIns: 3120, points: 15600 }
        ]
      };
      
      setAnalyticsData(mockAnalytics);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('loyalty', 'view')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to view analytics.</p>
      </div>
    );
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-gray-500">No analytics data available.</p>
      </div>
    );
  }

  const stats = [
    {
      name: 'Total Members',
      value: analyticsData.totalMembers.toLocaleString(),
      change: `+${analyticsData.newMembersThisWeek}`,
      changeType: 'positive' as const,
      icon: UserGroupIcon,
      description: 'this week'
    },
    {
      name: 'Active Members',
      value: analyticsData.activeMembers.toLocaleString(),
      change: `${((analyticsData.activeMembers / analyticsData.totalMembers) * 100).toFixed(1)}%`,
      changeType: 'neutral' as const,
      icon: ArrowTrendingUpIcon,
      description: 'engagement rate'
    },
    {
      name: 'Points Redeemed',
      value: `${(analyticsData.redemptionRate).toFixed(1)}%`,
      change: `${analyticsData.totalPointsRedeemed.toLocaleString()} pts`,
      changeType: 'positive' as const,
      icon: GiftIcon,
      description: 'total redeemed'
    },
    {
      name: 'Check-in Rate',
      value: `${analyticsData.checkInRate}%`,
      change: `${analyticsData.averageVisitsPerMember.toFixed(1)} avg`,
      changeType: 'positive' as const,
      icon: ChartBarIcon,
      description: 'visits per member'
    }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Operational Status Banner */}
      {!programOperational && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2" />
            <div>
              <p className="text-yellow-800 font-medium">Viewing Historical Data</p>
              <p className="text-sm text-yellow-700">
                The loyalty program is not operational. Analytics show historical data. New points won't be earned until you 
                <Link href="/settings/loyalty" className="ml-1 text-yellow-900 underline">enable operations</Link>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Loyalty Analytics</h1>
            <p className="mt-1 text-gray-500">
              Track performance and member engagement for The Anchor VIP Club
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
              <option value="quarter">Last 3 months</option>
              <option value="year">Last 12 months</option>
            </select>
            <Link
              href="/loyalty/admin"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <stat.icon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {stat.name}
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-gray-900">
                        {stat.value}
                      </div>
                      <div className={`ml-2 flex items-baseline text-sm font-semibold ${
                        stat.changeType === 'positive' ? 'text-green-600' : 'text-gray-600'
                      }`}>
                        {stat.change}
                      </div>
                    </dd>
                    <dd className="text-xs text-gray-500 mt-1">
                      {stat.description}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tier Distribution */}
      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Member Distribution by Tier</h2>
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
      </div>

      {/* Popular Times and Rewards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Popular Check-in Times */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Peak Check-in Times</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium text-gray-500">
              <span>Day</span>
              <span>Check-ins</span>
            </div>
            {Object.entries(analyticsData.checkInsByDayOfWeek)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([day, count]) => (
                <div key={day} className="flex items-center justify-between">
                  <span className="text-sm">{day}</span>
                  <div className="flex items-center">
                    <div className="w-32 bg-gray-200 rounded-full h-2 mr-3">
                      <div 
                        className="bg-amber-600 h-2 rounded-full" 
                        style={{ width: `${(count / 342) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{count}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Most Popular Rewards */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Most Redeemed Rewards</h2>
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
        </div>
      </div>

      {/* Monthly Trends Chart (Simplified) */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Monthly Growth Trends</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Month
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Members
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Check-ins
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Points Issued
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Growth
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {analyticsData.monthlyTrends.map((month, index) => {
                const previousMonth = analyticsData.monthlyTrends[index - 1];
                const growth = previousMonth 
                  ? ((month.members - previousMonth.members) / previousMonth.members * 100).toFixed(1)
                  : '0';
                  
                return (
                  <tr key={month.month}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {month.month}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {month.members.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {month.checkIns.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {month.points.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`flex items-center ${
                        parseFloat(growth) > 0 ? 'text-green-600' : 
                        parseFloat(growth) < 0 ? 'text-red-600' : 
                        'text-gray-500'
                      }`}>
                        {parseFloat(growth) > 0 ? (
                          <ArrowUpIcon className="h-4 w-4 mr-1" />
                        ) : parseFloat(growth) < 0 ? (
                          <ArrowDownIcon className="h-4 w-4 mr-1" />
                        ) : null}
                        {growth}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/loyalty/admin/members"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <UserGroupIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">View All Members</p>
              <p className="text-sm text-gray-500">Browse and manage</p>
            </div>
          </Link>
          
          <Link
            href="/messages/bulk"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <ArrowTrendingUpIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Send Campaign</p>
              <p className="text-sm text-gray-500">Target VIP members</p>
            </div>
          </Link>
          
          <Link
            href="/loyalty/admin/rewards"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <GiftIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Manage Rewards</p>
              <p className="text-sm text-gray-500">Update catalog</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}