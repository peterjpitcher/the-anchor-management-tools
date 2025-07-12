'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { normalizePhoneNumber, mockMembers, mockBookings, todaysEvent, tierConfig, getPointsForEvent, achievements, memberAchievements } from '@/lib/mock-data/loyalty-demo';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

type CheckInState = 'input' | 'checking' | 'success' | 'not-found' | 'already-checked' | 'new-member' | 'collect-name';

function CheckInPageContent() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<CheckInState>('input');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [memberData, setMemberData] = useState<any>(null);
  const [bookingData, setBookingData] = useState<any>(null);
  
  const eventId = searchParams.get('event') || todaysEvent.id;

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('checking');
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const normalized = normalizePhoneNumber(phoneNumber);
    const member = mockMembers[normalized];
    const booking = mockBookings.find(b => b.phoneNumber === normalized && b.eventId === eventId);
    
    if (booking && booking.checkedIn) {
      setState('already-checked');
      setMemberData(member);
      return;
    }
    
    if (booking) {
      // Existing member with booking
      setMemberData(member);
      setBookingData(booking);
      setState('success');
      
      // Mark as checked in (in real app, this would be an API call)
      booking.checkedIn = true;
      booking.checkInTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } else if (member) {
      // Member but no booking - allow check-in anyway
      setMemberData(member);
      setState('success');
    } else {
      // New customer - collect their name first
      setState('collect-name');
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!firstName.trim() || !lastName.trim()) {
      alert('Please enter both first and last name');
      return;
    }
    
    setState('checking');
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create new member with proper name format
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const newMember = {
      id: `member-${Date.now()}`,
      customerId: `cust-${Date.now()}`,
      customerName: fullName,
      phoneNumber: normalizePhoneNumber(phoneNumber),
      tier: 'member' as const,
      totalPoints: 50, // Welcome bonus
      availablePoints: 50,
      lifetimeEvents: 1, // First check-in
      joinDate: new Date().toISOString().split('T')[0],
      lastVisit: new Date().toISOString().split('T')[0]
    };
    
    // In production, this would be saved to database
    mockMembers[newMember.phoneNumber] = newMember;
    setMemberData(newMember);
    setState('new-member');
  };

  const getNewAchievements = () => {
    // Simulate checking for new achievements
    if (memberData?.lifetimeEvents === 4) {
      return achievements.find(a => a.id === 'ach-1'); // About to get Quiz Regular
    }
    return null;
  };

  const renderTierProgress = () => {
    if (!memberData) return null;
    
    const currentTier = tierConfig[memberData.tier as keyof typeof tierConfig];
    const nextTierKey = memberData.tier === 'member' ? 'bronze' : 
                       memberData.tier === 'bronze' ? 'silver' :
                       memberData.tier === 'silver' ? 'gold' :
                       memberData.tier === 'gold' ? 'platinum' : null;
    
    if (!nextTierKey) return null;
    
    const nextTier = tierConfig[nextTierKey as keyof typeof tierConfig];
    const eventsNeeded = nextTier.minEvents - memberData.lifetimeEvents;
    
    return (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">Progress to {nextTier.name}</span>
          <span className="text-sm font-medium">{eventsNeeded} events away</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="h-2 rounded-full transition-all duration-500"
            style={{
              width: `${(memberData.lifetimeEvents / nextTier.minEvents) * 100}%`,
              backgroundColor: nextTier.color
            }}
          />
        </div>
      </div>
    );
  };

  if (state === 'input') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-8">
              <div className="mb-6">
                <VIPClubLogo size="medium" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to {todaysEvent.name}!</h1>
              <p className="text-gray-600">Check in to earn your VIP points</p>
            </div>
            
            <form onSubmit={handleCheckIn} className="space-y-6">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                  Enter your phone number
                </label>
                <input
                  type="tel"
                  id="phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                  placeholder="07700 900123"
                  required
                />
              </div>
              
              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Check In
              </button>
            </form>
            
            <p className="mt-6 text-center text-sm text-gray-500">
              First time? You&apos;ll automatically join our VIP program!
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking you in...</p>
        </div>
      </div>
    );
  }

  if (state === 'already-checked') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Already Checked In!</h1>
            <p className="text-gray-600 mb-6">You&apos;ve already checked in for tonight&apos;s event.</p>
            
            <button
              onClick={() => window.location.href = `/loyalty?phone=${phoneNumber}`}
              className="bg-amber-600 text-white py-2 px-6 rounded-lg font-semibold hover:bg-amber-700 transition-colors"
            >
              View My VIP Status
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'success' && memberData) {
    const pointsEarned = getPointsForEvent(memberData.tier, todaysEvent.type);
    const newAchievement = getNewAchievements();
    const tier = tierConfig[memberData.tier as keyof typeof tierConfig];
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">✅</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Welcome back, {memberData.customerName.split(' ')[0]}!
              </h1>
              <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium" 
                   style={{ backgroundColor: `${tier.color}20`, color: tier.color }}>
                {tier.icon} {tier.name}
              </div>
            </div>
            
            <div className="bg-amber-50 rounded-lg p-4 mb-6">
              <p className="text-center text-lg font-semibold text-amber-900">
                You&apos;ve earned {pointsEarned} points!
              </p>
              <p className="text-center text-sm text-amber-700 mt-1">
                ({tier.name} earns {tier.pointMultiplier}x points)
              </p>
            </div>
            
            {newAchievement && (
              <div className="bg-purple-50 rounded-lg p-4 mb-6">
                <p className="text-center font-semibold text-purple-900 mb-1">
                  🏆 Achievement Unlocked!
                </p>
                <p className="text-center text-purple-700">
                  {newAchievement.name} - {newAchievement.description}
                </p>
              </div>
            )}
            
            {renderTierProgress()}
            
            <div className="mt-6 space-y-3">
              <h3 className="font-semibold text-gray-900">Your rewards tonight:</h3>
              {memberData.tier === 'silver' && (
                <>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">15% off ticketed events</span>
                    <span className="text-green-600 text-sm font-medium">Active</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Skip-the-queue privilege</span>
                    <span className="text-green-600 text-sm font-medium">Active</span>
                  </div>
                </>
              )}
              {memberData.tier === 'gold' && (
                <>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Complimentary welcome drink</span>
                    <span className="text-green-600 text-sm font-medium">Available</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">20% off all events</span>
                    <span className="text-green-600 text-sm font-medium">Active</span>
                  </div>
                </>
              )}
              {/* Birthday check */}
              {new Date().getMonth() === 11 && memberData.id === '1' && (
                <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <span className="text-gray-700">🎂 Birthday month free shot!</span>
                  <span className="text-yellow-600 text-sm font-medium">This month!</span>
                </div>
              )}
            </div>
            
            <div className="mt-8 space-y-3">
              <button
                onClick={() => window.location.href = `/loyalty?phone=${phoneNumber}`}
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-amber-700 transition-colors"
              >
                View My VIP Status
              </button>
              <button
                onClick={() => setState('input')}
                className="w-full bg-gray-100 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'collect-name') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-8">
              <div className="mb-6">
                <VIPClubLogo size="medium" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome! Let&apos;s get you started</h1>
              <p className="text-gray-600">Please tell us your name to join The Anchor VIP Club</p>
            </div>
            
            <form onSubmit={handleNameSubmit} className="space-y-6">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                  placeholder="John"
                  required
                  autoFocus
                />
              </div>
              
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                  placeholder="Smith"
                  required
                />
              </div>
              
              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Join VIP Club
              </button>
            </form>
            
            <p className="mt-6 text-center text-sm text-gray-500">
              By joining, you&apos;ll receive SMS updates about events and rewards
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'new-member') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">🎉</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Welcome to Anchor VIPs, {memberData?.customerName?.split(' ')[0]}!
              </h1>
              <p className="text-gray-600">You&apos;re now part of our exclusive VIP program!</p>
            </div>
            
            <div className="bg-amber-50 rounded-lg p-4 mb-6">
              <p className="text-center text-lg font-semibold text-amber-900">
                You&apos;ve earned 50 welcome points!
              </p>
            </div>
            
            <div className="space-y-3 mb-8">
              <h3 className="font-semibold text-gray-900">As a new VIP member, you get:</h3>
              <ul className="space-y-2">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-700">Exclusive event announcements</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-700">Points for every visit</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-700">Birthday month rewards</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-700">Tier upgrades with amazing perks</span>
                </li>
              </ul>
            </div>
            
            <div className="space-y-3">
              <button
                onClick={() => window.location.href = `/loyalty?phone=${phoneNumber}&new=true`}
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-amber-700 transition-colors"
              >
                Explore VIP Benefits
              </button>
              <button
                onClick={() => setState('input')}
                className="w-full bg-gray-100 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function CheckInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <CheckInPageContent />
    </Suspense>
  );
}