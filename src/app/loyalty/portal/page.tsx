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
import { validatePortalSession, endPortalSession, validateTokenAccess } from '@/app/actions/loyalty-otp';
import { getMemberTierProgress } from '@/app/actions/loyalty-tiers';
import { getMemberRedemptions } from '@/app/actions/loyalty-redemptions';
import { createRedemption } from '@/app/actions/loyalty-redemptions';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';
import { Page } from '@/components/ui-v2/layout/Page';
import { Container } from '@/components/ui-v2/layout/Container';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Button } from '@/components/ui-v2/forms/Button';
import { Tabs, TabsNav } from '@/components/ui-v2/navigation/Tabs';
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';

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
    // Check for token in URL first
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
      // Validate token directly
      try {
        const result = await validateTokenAccess(urlToken);
        if (result.success && result.member) {
          setMember(result.member);
          loadMemberData(result.member.id);
          // Set session cookie for future visits
          document.cookie = `loyalty_session=${urlToken}; path=/; max-age=2592000`; // 30 days
          // Remove token from URL for cleaner appearance
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }
      } catch (error) {
        console.error('Token validation error:', error);
      }
    }
    
    // Otherwise check for session token from cookie
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
      <Page title="VIP Dashboard" className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" className="mx-auto mb-4 text-amber-600" />
          <p className="text-gray-600">Loading your VIP dashboard...</p>
        </div>
      </Page>
    );
  }

  if (!member) {
    return null;
  }

  const tier = member.tier;
  const customer = member.customer;

  return (
    <Page title="VIP Dashboard" className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <Container size="2xl" className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <VIPClubLogo size="small" />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                  Welcome back, {customer?.name?.split(' ')[0]}!
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge
                    style={{ 
                      backgroundColor: `${tier?.color}20`, 
                      color: tier?.color 
                    }}
                  >
                    {tier?.icon} {tier?.name}
                  </Badge>
                </div>
              </div>
            </div>
            <Button onClick={handleLogout}
              variant="secondary"
              leftIcon={<ArrowRightOnRectangleIcon className="h-5 w-5" />}
            >
              Logout
            </Button>
          </div>
        </Container>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <Container size="2xl">
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as any)}
            variant="underline"
            align="start"
            items={[
              { 
                key: 'overview', 
                label: 'Overview', 
                icon: <ChartBarIcon className="h-4 w-4 sm:h-5 sm:w-5" />,
                content: null // Content will be rendered below
              },
              { 
                key: 'rewards', 
                label: 'Rewards', 
                icon: <GiftIcon className="h-4 w-4 sm:h-5 sm:w-5" />,
                content: null
              },
              { 
                key: 'history', 
                label: 'History', 
                icon: <CalendarIcon className="h-4 w-4 sm:h-5 sm:w-5" />,
                content: null
              },
              { 
                key: 'benefits', 
                label: 'Benefits', 
                icon: <SparklesIcon className="h-4 w-4 sm:h-5 sm:w-5" />,
                content: null
              }
            ]}
            tabListClassName="overflow-x-auto scrollbar-hide"
            bordered={false}
            padded={false}
          />
        </Container>
      </div>

      {/* Content */}
      <Container size="2xl" className="py-8">
        {activeTab === 'overview' && (
          <Section>
            {/* Points Summary */}
            <Card>
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
            </Card>

            {/* Tier Progress */}
            {tierProgress && tierProgress.nextTier && (
              <Card>
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
                    <ProgressBar
                      value={tierProgress.progressPercentage}
                      max={100}
                      color={tierProgress.nextTier.color}
                      className="h-2"
                    />
                  </div>
                </div>
              </Card>
            )}
          </Section>
        )}

        {activeTab === 'rewards' && (
          <Section>
            <Card>
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
                        <Card key={reward.id} variant="bordered" interactive>
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
                                  <Badge variant="error" size="sm">
                                    Only {reward.inventory} left!
                                  </Badge>
                                )}
                              </div>
                              
                              {requiresTier && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Requires {reward.tier?.name} tier
                                </p>
                              )}
                            </div>
                            
                            <Button
                              onClick={() => handleRedeemReward(reward)}
                              disabled={!canRedeem || requiresTier}
                              variant="primary"
                              size="sm"
                              className="ml-4 bg-amber-600 hover:bg-amber-700"
                              title={
                                !canRedeem ? 'Not enough points' : 
                                requiresTier ? `Requires ${reward.tier?.name} tier` : 
                                'Click to redeem'
                              }
                            >
                              Redeem
                            </Button>
                          </div>
                        </Card>
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
            </Card>
          </Section>
        )}

        {activeTab === 'history' && (
          <Section>
            {/* Point History */}
            <Card>
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
            </Card>
            
            {/* Recent Redemptions */}
            <Card>
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
                        <Alert variant="warning" size="sm" className="mt-2">
                          Code: <Badge variant="warning">{redemption.code}</Badge>
                        </Alert>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No redemptions yet</p>
              )}
            </Card>
          </Section>
        )}

        {activeTab === 'benefits' && (
          <Section>
            <Card>
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
            </Card>

            {/* All Tiers */}
            {tierProgress?.allTiers && (
              <Card>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">All VIP Tiers</h2>
                <div className="space-y-4">
                  {tierProgress.allTiers.map((t: any) => (
                    <Card 
                      key={t.id} 
                      variant={t.isActive ? 'elevated' : 'bordered'}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-gray-900">
                          {t.icon} {t.name}
                        </h3>
                        {t.isUnlocked && (
                          <Badge variant="success" size="sm">✓ Unlocked</Badge>
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
                    </Card>
                  ))}
                </div>
              </Card>
            )}
          </Section>
        )}
      </Container>
    </Page>
  );
}