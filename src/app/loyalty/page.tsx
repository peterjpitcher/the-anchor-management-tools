'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { normalizePhoneNumber, mockMembers, tierConfig, achievements, memberAchievements, rewards, activeRedemptionCodes, generateRedemptionCode } from '@/lib/mock-data/loyalty-demo';
import QRCode from 'qrcode';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

type ViewMode = 'dashboard' | 'achievements' | 'rewards' | 'history';

function LoyaltyDashboardContent() {
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [memberData, setMemberData] = useState<any>(null);
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [activeCode, setActiveCode] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  
  useEffect(() => {
    const phone = searchParams.get('phone');
    if (phone) {
      const normalized = normalizePhoneNumber(phone);
      setPhoneNumber(normalized);
      const member = mockMembers[normalized];
      setMemberData(member);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeCode && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            setActiveCode(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [activeCode, timeRemaining]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const generateCode = async (reward: any) => {
    if (activeCode) return;
    
    const code = generateRedemptionCode(reward.id);
    const newCode = {
      code,
      rewardId: reward.id,
      memberId: memberData.id,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      used: false
    };
    
    // Generate QR code for staff scanning
    const qrData = {
      code: code,
      customerId: memberData.id
    };
    // Encode the data for URL parameter
    const encodedData = encodeURIComponent(JSON.stringify(qrData));
    const verifyUrl = `${window.location.origin}/loyalty/redeem/verify?data=${encodedData}`;
    
    const qrUrl = await QRCode.toDataURL(verifyUrl, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    setQrDataUrl(qrUrl);
    
    activeRedemptionCodes.push(newCode);
    setActiveCode(newCode);
    setTimeRemaining(300); // 5 minutes
    setSelectedReward(reward);
  };

  if (!memberData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const tier = tierConfig[memberData.tier as keyof typeof tierConfig];
  const memberAchievementIds = memberAchievements[memberData.id] || [];
  
  const nextTierKey = memberData.tier === 'member' ? 'bronze' : 
                     memberData.tier === 'bronze' ? 'silver' :
                     memberData.tier === 'silver' ? 'gold' :
                     memberData.tier === 'gold' ? 'platinum' : null;
  const nextTier = nextTierKey ? tierConfig[nextTierKey as keyof typeof tierConfig] : null;

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{memberData.customerName}</h2>
            <div className="inline-flex items-center mt-2 px-3 py-1 rounded-full text-sm font-medium" 
                 style={{ backgroundColor: `${tier.color}20`, color: tier.color }}>
              {tier.icon} {tier.name}
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-900">{memberData.availablePoints}</p>
            <p className="text-sm text-gray-600">Available Points</p>
          </div>
        </div>
        
        {nextTier && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Progress to {nextTier.name}</span>
              <span className="text-sm font-medium">{nextTier.minEvents - memberData.lifetimeEvents} events away</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="h-3 rounded-full transition-all duration-500"
                style={{
                  width: `${(memberData.lifetimeEvents / nextTier.minEvents) * 100}%`,
                  backgroundColor: nextTier.color
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-sm text-gray-600">Lifetime Events</p>
          <p className="text-2xl font-bold text-gray-900">{memberData.lifetimeEvents}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-sm text-gray-600">Member Since</p>
          <p className="text-2xl font-bold text-gray-900">
            {new Date(memberData.joinDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Recent Achievements */}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Achievements</h3>
        <div className="grid grid-cols-2 gap-3">
          {memberAchievementIds.slice(0, 4).map(achId => {
            const achievement = achievements.find(a => a.id === achId);
            if (!achievement) return null;
            return (
              <div key={achId} className="flex items-center space-x-3 p-3 bg-purple-50 rounded-lg">
                <span className="text-2xl">{achievement.icon}</span>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{achievement.name}</p>
                  <p className="text-xs text-gray-600">+{achievement.pointsValue} pts</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Available Rewards Preview */}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Rewards</h3>
        <div className="space-y-3">
          {rewards
            .filter(r => !r.tierRequired || tierConfig[r.tierRequired as keyof typeof tierConfig].minEvents <= memberData.lifetimeEvents)
            .filter(r => r.pointsCost <= memberData.availablePoints)
            .slice(0, 3)
            .map(reward => (
              <div key={reward.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{reward.icon}</span>
                  <div>
                    <p className="font-medium text-gray-900">{reward.name}</p>
                    <p className="text-sm text-gray-600">{reward.pointsCost} points</p>
                  </div>
                </div>
                <button
                  onClick={() => setViewMode('rewards')}
                  className="text-amber-600 text-sm font-medium"
                >
                  View
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );

  const renderAchievements = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Achievements</h3>
        <div className="grid grid-cols-1 gap-4">
          {achievements.map(achievement => {
            const isUnlocked = memberAchievementIds.includes(achievement.id);
            return (
              <div 
                key={achievement.id} 
                className={`flex items-center space-x-4 p-4 rounded-lg border-2 ${
                  isUnlocked ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <span className={`text-3xl ${!isUnlocked && 'opacity-30'}`}>
                  {achievement.icon}
                </span>
                <div className="flex-1">
                  <p className={`font-medium ${isUnlocked ? 'text-gray-900' : 'text-gray-500'}`}>
                    {achievement.name}
                  </p>
                  <p className="text-sm text-gray-600">{achievement.description}</p>
                </div>
                <div className="text-right">
                  {isUnlocked ? (
                    <span className="text-green-600 font-medium">✓ Earned</span>
                  ) : (
                    <span className="text-gray-400 text-sm">+{achievement.pointsValue} pts</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderRewards = () => (
    <div className="space-y-6">
      {activeCode && selectedReward && (
        <div className="bg-amber-100 border-2 border-amber-300 rounded-xl p-6">
          <div className="text-center">
            <p className="text-sm font-medium text-amber-800 mb-3">SHOW THIS TO YOUR SERVER</p>
            
            {/* QR Code for scanning */}
            <div className="bg-white p-4 rounded-lg inline-block mb-4">
              <img src={qrDataUrl} alt="Redemption QR" className="w-48 h-48" />
            </div>
            
            {/* Reward details */}
            <div className="mb-4">
              <p className="text-2xl font-bold text-gray-900">{selectedReward.name}</p>
              <p className="text-sm text-gray-600">{selectedReward.description}</p>
            </div>
            
            {/* Code as backup */}
            <div className="mb-3">
              <p className="text-xs text-gray-600 mb-1">Or enter code manually:</p>
              <p className={`text-2xl font-bold font-mono tracking-wider ${timeRemaining < 60 ? 'text-red-600' : 'text-gray-900'}`}>
                {activeCode.code}
              </p>
            </div>
            
            {/* Timer */}
            <p className={`text-lg font-medium ${timeRemaining < 60 ? 'text-red-600' : 'text-amber-700'}`}>
              ⏱️ Expires in: {formatTime(timeRemaining)}
            </p>
            
            {timeRemaining < 60 && (
              <p className="text-sm text-red-600 mt-2 font-medium">⚠️ Code expiring soon!</p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Rewards</h3>
        <div className="space-y-4">
          {rewards.map(reward => {
            const canRedeem = (!reward.tierRequired || tierConfig[reward.tierRequired as keyof typeof tierConfig].minEvents <= memberData.lifetimeEvents) 
                            && reward.pointsCost <= memberData.availablePoints;
            const isActive = activeCode?.rewardId === reward.id;
            
            return (
              <div 
                key={reward.id} 
                className={`p-4 rounded-lg border-2 ${
                  canRedeem ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className={`text-3xl ${!canRedeem && 'opacity-50'}`}>
                      {reward.icon}
                    </span>
                    <div>
                      <p className={`font-medium ${canRedeem ? 'text-gray-900' : 'text-gray-500'}`}>
                        {reward.name}
                      </p>
                      <p className="text-sm text-gray-600">{reward.description}</p>
                      <p className="text-sm font-medium text-amber-600 mt-1">{reward.pointsCost} points</p>
                    </div>
                  </div>
                  {canRedeem && (
                    <button
                      onClick={() => generateCode(reward)}
                      disabled={!!activeCode}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        activeCode 
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                          : 'bg-amber-600 text-white hover:bg-amber-700'
                      }`}
                    >
                      {isActive ? 'Active' : activeCode ? 'Wait' : 'Redeem'}
                    </button>
                  )}
                  {!canRedeem && reward.tierRequired && (
                    <span className="text-sm text-gray-500">
                      Requires {tierConfig[reward.tierRequired as keyof typeof tierConfig].name}
                    </span>
                  )}
                  {!canRedeem && !reward.tierRequired && (
                    <span className="text-sm text-gray-500">
                      Need {reward.pointsCost - memberData.availablePoints} more pts
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {activeCode && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg">
            <p className="text-sm text-amber-800">
              💡 TIP: Only reveal code when your server is nearby. You can only have one active code at a time.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Event History</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Quiz Night</p>
              <p className="text-sm text-gray-600">27 Nov 2024</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-green-600">+150 pts</p>
              <p className="text-xs text-gray-600">Silver bonus</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Drag Cabaret</p>
              <p className="text-sm text-gray-600">15 Nov 2024</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-green-600">+150 pts</p>
              <p className="text-xs text-gray-600">Silver bonus</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Bingo Night</p>
              <p className="text-sm text-gray-600">8 Nov 2024</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-green-600">+150 pts</p>
              <p className="text-xs text-gray-600">Silver bonus</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div>
              <p className="font-medium text-gray-900">Karaoke Night</p>
              <p className="text-sm text-gray-600">29 Oct 2024</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-green-600">+150 pts</p>
              <p className="text-xs text-purple-600">🏆 Karaoke Star unlocked!</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-900 via-amber-800 to-amber-700 text-white p-6 shadow-xl">
        <div className="max-w-lg mx-auto text-center">
          <div className="mb-4">
            <VIPClubLogo size="medium" />
          </div>
          <h1 className="text-2xl font-bold">Your VIP Dashboard</h1>
          <p className="text-amber-100 mt-1">Manage your rewards and achievements</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-6">
        {viewMode === 'dashboard' && renderDashboard()}
        {viewMode === 'achievements' && renderAchievements()}
        {viewMode === 'rewards' && renderRewards()}
        {viewMode === 'history' && renderHistory()}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-lg mx-auto">
          <div className="grid grid-cols-4 text-center">
            <button
              onClick={() => setViewMode('dashboard')}
              className={`py-3 px-4 flex flex-col items-center space-y-1 ${
                viewMode === 'dashboard' ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              <span className="text-2xl">🏠</span>
              <span className="text-xs">Home</span>
            </button>
            <button
              onClick={() => setViewMode('achievements')}
              className={`py-3 px-4 flex flex-col items-center space-y-1 ${
                viewMode === 'achievements' ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              <span className="text-2xl">🏆</span>
              <span className="text-xs">Achievements</span>
            </button>
            <button
              onClick={() => setViewMode('rewards')}
              className={`py-3 px-4 flex flex-col items-center space-y-1 ${
                viewMode === 'rewards' ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              <span className="text-2xl">🎁</span>
              <span className="text-xs">Rewards</span>
            </button>
            <button
              onClick={() => setViewMode('history')}
              className={`py-3 px-4 flex flex-col items-center space-y-1 ${
                viewMode === 'history' ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              <span className="text-2xl">📋</span>
              <span className="text-xs">History</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoyaltyDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <LoyaltyDashboardContent />
    </Suspense>
  );
}