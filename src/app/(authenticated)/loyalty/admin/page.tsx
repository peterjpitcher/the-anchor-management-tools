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
  CogIcon,
  ArrowUpIcon,
  ArrowDownIcon 
} from '@heroicons/react/24/outline';

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
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading loyalty statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-600">Error: {error}</p>
      </div>
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-gray-900">Loyalty Program Dashboard</h1>
          <p className="mt-1 text-gray-500">Monitor and manage The Anchor VIP Club</p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4 space-x-3">
          <Link
            href="/loyalty/admin/members"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <UserGroupIcon className="h-4 w-4 mr-2" />
            Members
          </Link>
          <Link
            href="/loyalty/admin/rewards"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <GiftIcon className="h-4 w-4 mr-2" />
            Rewards
          </Link>
          <Link
            href="/loyalty/admin/achievements"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <TrophyIcon className="h-4 w-4 mr-2" />
            Achievements
          </Link>
          <Link
            href="/loyalty/analytics"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <ChartBarIcon className="h-4 w-4 mr-2" />
            Analytics
          </Link>
          <Link
            href="/loyalty/admin/settings"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
          >
            <CogIcon className="h-4 w-4 mr-2" />
            Settings
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UserGroupIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Members</dt>
                  <dd className="text-lg font-semibold text-gray-900">{stats?.totalMembers || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ChartBarIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Points Issued</dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    {stats?.totalPointsIssued.toLocaleString() || 0}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <GiftIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Active Redemptions</dt>
                  <dd className="text-lg font-semibold text-gray-900">{stats?.activeRedemptions || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrophyIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Redemption Rate</dt>
                  <dd className="text-lg font-semibold text-gray-900">{redemptionRate}%</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tier Distribution */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Member Distribution by Tier</h3>
          
          <div className="space-y-4">
            {stats && Object.entries(stats.membersByTier).map(([tier, count]) => {
              const percentage = stats.totalMembers > 0 ? (count / stats.totalMembers) * 100 : 0;
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 capitalize">{tier}</span>
                    <span className="text-sm text-gray-600">{count} members ({percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${tierColors[tier as keyof typeof tierColors]}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Quick Actions</h3>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/loyalty/admin/enroll"
              className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
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
              className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
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
              className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
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
              className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
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
              className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-amber-500"
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
        </div>
      </div>
    </div>
  );
}