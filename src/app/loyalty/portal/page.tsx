'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowRightOnRectangleIcon,
  SparklesIcon,
  TrophyIcon,
  TicketIcon,
  CalendarIcon,
  GiftIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { validatePortalSession, endPortalSession } from '@/app/actions/loyalty-otp';
import { getMemberTierProgress } from '@/app/actions/loyalty-tiers';
import { getMemberRedemptions } from '@/app/actions/loyalty-redemptions';
import { createRedemption } from '@/app/actions/loyalty-redemptions';
import { Loader2 } from 'lucide-react';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

export default function LoyaltyPortalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<any>(null);
  const [tierProgress, setTierProgress] = useState<any>(null);
  const [recentRedemptions, setRecentRedemptions] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [pointHistory, setPointHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'rewards' | 'history' | 'benefits'>('overview');

  useEffect(() => {
    validateSession();
  }, []);

  const validateSession = async () => {
    // Get session token from cookie
    const cookies = document.cookie.split(';');
    const sessionCookie = cookies.find(c => c.trim().startsWith('loyalty_session='));
    
    if (!sessionCookie) {
      router.push('/loyalty/portal/login');
      return;
    }
    
    const sessionToken = sessionCookie.split('=')[1];
    
    try {
      const result = await validatePortalSession(sessionToken);
      
      if (result.error) {
        toast.error(result.error);
        router.push('/loyalty/portal/login');
        return;
      }
      
      if (result.data) {
        setMember(result.data.member);
        await loadMemberData(result.data.member.id);
      }
    } catch (error) {
      toast.error('Session validation failed');
      router.push('/loyalty/portal/login');
    } finally {
      setLoading(false);
    }
  };

  const loadMemberData = async (memberId: string) => {
    try {
      // Load tier progress
      const tierResult = await getMemberTierProgress(memberId);
      if (tierResult.data) {
        setTierProgress(tierResult.data);
      }
      
      // Load recent redemptions
      const redemptionsResult = await getMemberRedemptions(memberId);
      if (redemptionsResult.data) {
        setRecentRedemptions(redemptionsResult.data.slice(0, 5));
      }
      
      // Load available rewards from database
      const { getRewards } = await import('@/app/actions/loyalty-rewards');
      const rewardsResult = await getRewards({ active: true });
      if (rewardsResult.data) {
        setRewards(rewardsResult.data);
      }
      
      // Load point transaction history
      const { getMemberTransactions } = await import('@/app/actions/loyalty-transactions');
      const transactionsResult = await getMemberTransactions(memberId);
      if (transactionsResult.data) {
        setPointHistory(transactionsResult.data);
      }
    } catch (error) {
      console.error('Failed to load member data:', error);
    }
  };

  const handleLogout = async () => {
    const cookies = document.cookie.split(';');
    const sessionCookie = cookies.find(c => c.trim().startsWith('loyalty_session='));
    
    if (sessionCookie) {
      const sessionToken = sessionCookie.split('=')[1];
      await endPortalSession(sessionToken);
    }
    
    // Clear cookie
    document.cookie = 'loyalty_session=; path=/; max-age=0';
    
    toast.success('Logged out successfully');
    router.push('/loyalty');
  };

  const handleRedeemReward = async (reward: any) => {
    if (member.available_points < reward.points_cost) {
      toast.error('Insufficient points');
      return;
    }
    
    try {
      const result = await createRedemption({
        member_id: member.id,
        reward_id: reward.id,
        points_to_spend: reward.points_cost
      });
      
      if (result.error) {
        toast.error(result.error);
        return;
      }
      
      if (result.data) {
        toast.success(`Redemption code: ${result.data.code}`);
        // Refresh member data
        await validateSession();
      }
    } catch (error) {
      toast.error('Failed to redeem reward');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-amber-600" />
          <p className="text-gray-600">Loading your VIP dashboard...</p>
        </div>
      </div>
    );
  }

  if (!member) {
    return null;
  }

  const tier = member.tier;
  const customer = member.customer;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <VIPClubLogo size="small" />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                  Welcome back, {customer?.name?.split(' ')[0]}!
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <span 
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                    style={{ 
                      backgroundColor: `${tier?.color}20`, 
                      color: tier?.color 
                    }}
                  >
                    {tier?.icon} {tier?.name}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="inline-flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5 mr-1" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto">
          <nav className="flex overflow-x-auto scrollbar-hide">
            {[
              { id: 'overview', label: 'Overview', icon: ChartBarIcon },
              { id: 'rewards', label: 'Rewards', icon: GiftIcon },
              { id: 'history', label: 'History', icon: CalendarIcon },
              { id: 'benefits', label: 'Benefits', icon: SparklesIcon }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 px-4 sm:px-6 border-b-2 font-medium text-sm flex items-center space-x-1 sm:space-x-2 whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="text-xs sm:text-sm">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Points Summary */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Points</h2>
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-amber-600">{member.available_points}</p>
                  <p className="text-xs sm:text-sm text-gray-500">Available</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-gray-600">{member.lifetime_points}</p>
                  <p className="text-xs sm:text-sm text-gray-500">Lifetime</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-gray-600">{member.lifetime_events}</p>
                  <p className="text-xs sm:text-sm text-gray-500">Events</p>
                </div>
              </div>
            </div>

            {/* Tier Progress */}
            {tierProgress && tierProgress.nextTier && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Tier Progress</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Current Tier</span>
                    <span className="font-medium">{tierProgress.currentTier.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Next Tier</span>
                    <span className="font-medium">{tierProgress.nextTier.name}</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Progress</span>
                      <span className="text-sm font-medium">
                        {tierProgress.eventsToNextTier} events to go
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${tierProgress.progressPercentage}%`,
                          backgroundColor: tierProgress.nextTier.color
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'rewards' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Rewards</h2>
              
              {/* Group rewards by category */}
              {Object.entries(
                rewards.reduce((acc, reward) => {
                  const category = reward.category || 'other';
                  if (!acc[category]) acc[category] = [];
                  acc[category].push(reward);
                  return acc;
                }, {} as Record<string, any[]>)
              ).map(([category, categoryRewards]) => (
                <div key={category} className="mb-6">
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(categoryRewards as any[]).map((reward: any) => {
                      const canRedeem = member.available_points >= reward.points_cost;
                      const requiresTier = reward.tier_required && reward.tier_required !== member.tier_id;
                      
                      return (
                        <div key={reward.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center">
                                {reward.icon && <span className="text-2xl mr-2">{reward.icon}</span>}
                                <h3 className="font-semibold text-gray-900">{reward.name}</h3>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{reward.description}</p>
                              
                              <div className="flex items-center justify-between mt-3">
                                <p className="text-lg font-bold text-amber-600">
                                  {reward.points_cost === 0 ? 'Free' : `${reward.points_cost} points`}
                                </p>
                                {reward.inventory !== null && reward.inventory < 10 && (
                                  <span className="text-xs text-red-600">
                                    Only {reward.inventory} left!
                                  </span>
                                )}
                              </div>
                              
                              {requiresTier && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Requires {reward.tier?.name} tier
                                </p>
                              )}
                            </div>
                            
                            <button
                              onClick={() => handleRedeemReward(reward)}
                              disabled={!canRedeem || requiresTier}
                              className="ml-4 px-3 py-2 sm:px-4 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base min-h-[40px] min-w-[70px]"
                              title={
                                !canRedeem ? 'Not enough points' : 
                                requiresTier ? `Requires ${reward.tier?.name} tier` : 
                                'Click to redeem'
                              }
                            >
                              Redeem
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              
              {rewards.length === 0 && (
                <p className="text-gray-500 text-center py-8">
                  No rewards available at the moment
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Point History */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Points History</h2>
              {pointHistory.length > 0 ? (
                <div className="space-y-3">
                  {pointHistory.map(transaction => (
                    <div key={transaction.id} className="border-b pb-3 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">
                            {transaction.description}
                          </p>
                          <p className="text-sm text-gray-500">
                            {new Date(transaction.created_at).toLocaleString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${transaction.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {transaction.points > 0 ? '+' : ''}{transaction.points}
                          </p>
                          <p className="text-xs text-gray-500">
                            Balance: {transaction.balance_after}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No transactions yet</p>
              )}
            </div>
            
            {/* Recent Redemptions */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Redemptions</h2>
              {recentRedemptions.length > 0 ? (
                <div className="space-y-3">
                  {recentRedemptions.map(redemption => (
                    <div key={redemption.id} className="border-b pb-3 last:border-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            {redemption.reward?.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {new Date(redemption.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-red-600">
                            -{redemption.points_spent} points
                          </p>
                          <p className="text-xs text-gray-500 uppercase">
                            {redemption.status}
                          </p>
                        </div>
                      </div>
                      {redemption.code && redemption.status === 'pending' && (
                        <div className="mt-2 p-2 bg-amber-50 rounded text-center">
                          <p className="text-sm text-amber-800">
                            Code: <span className="font-mono font-bold">{redemption.code}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No redemptions yet</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'benefits' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Your {tier?.name} Benefits
              </h2>
              {tier?.benefits && (
                <ul className="space-y-3">
                  {tier.benefits.map((benefit: string, index: number) => (
                    <li key={index} className="flex items-start">
                      <svg className="h-5 w-5 text-green-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">{benefit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* All Tiers */}
            {tierProgress?.allTiers && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">All VIP Tiers</h2>
                <div className="space-y-4">
                  {tierProgress.allTiers.map((t: any) => (
                    <div 
                      key={t.id} 
                      className={`border rounded-lg p-4 ${
                        t.isActive ? 'border-amber-500 bg-amber-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-gray-900">
                          {t.icon} {t.name}
                        </h3>
                        {t.isUnlocked && (
                          <span className="text-sm text-green-600">✓ Unlocked</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {t.min_events} events required • {t.point_multiplier}x points
                      </p>
                      {!t.isUnlocked && (
                        <p className="text-xs text-gray-500 mt-1">
                          {t.eventsRequired} more events to unlock
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}