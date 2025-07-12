'use client';

import { useState, useEffect } from 'react';
import { LoyaltyService } from '@/lib/services/loyalty';
import { LOYALTY_CONFIG } from '@/lib/config/loyalty';
import { LoyaltySettingsService } from '@/lib/config/loyalty-settings';
import Link from 'next/link';
import { enrollCustomer } from '@/app/actions/loyalty';
import toast from 'react-hot-toast';
import { usePermissions } from '@/contexts/PermissionContext';

interface CustomerLoyaltyCardProps {
  customerId: string;
  customerPhone: string;
  customerName: string;
}

export function CustomerLoyaltyCard({ customerId, customerPhone, customerName }: CustomerLoyaltyCardProps) {
  const { hasPermission } = usePermissions();
  const [loyaltyData, setLoyaltyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [programEnabled, setProgramEnabled] = useState(false);

  useEffect(() => {
    // Always show loyalty UI (configuration is always enabled)
    setProgramEnabled(true);
    loadLoyaltyData();

    // Listen for settings changes (though we always show the UI)
    const handleSettingsChange = (event: CustomEvent) => {
      // Keep UI enabled regardless of operational status
      setProgramEnabled(true);
    };

    window.addEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    return () => {
      window.removeEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    };
  }, [customerPhone]);

  const loadLoyaltyData = async () => {
    try {
      // In production, this would be a database query
      const member = await LoyaltyService.getMemberByPhone(customerPhone);
      if (member) {
        const stats = await LoyaltyService.getMemberStats(member.id);
        setLoyaltyData(stats);
      }
    } catch (error) {
      console.error('Error loading loyalty data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (!hasPermission('loyalty', 'enroll')) {
      toast.error('You do not have permission to enroll customers');
      return;
    }

    setEnrolling(true);
    try {
      const formData = new FormData();
      formData.append('customerId', customerId);
      formData.append('phoneNumber', customerPhone);
      
      const result = await enrollCustomer(formData);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Customer enrolled in VIP Club!');
        loadLoyaltyData();
      }
    } catch (error) {
      toast.error('Failed to enroll customer');
    } finally {
      setEnrolling(false);
    }
  };

  // Don't show the card if loyalty program is disabled
  if (!programEnabled) {
    return null;
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!loyaltyData) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">VIP Club Status</h3>
          <img src="/VIPs.png" alt="VIP Club" className="h-12" />
        </div>
        
        <p className="text-gray-600 mb-4">Not enrolled in loyalty program</p>
        
        {hasPermission('loyalty', 'enroll') && (
          <button
            onClick={handleEnroll}
            disabled={enrolling}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
          >
            {enrolling ? 'Enrolling...' : 'Enroll in VIP Club'}
          </button>
        )}
      </div>
    );
  }

  const { member, nextTier, availableRewards } = loyaltyData;
  const tier = LOYALTY_CONFIG.tiers[member.tier as keyof typeof LOYALTY_CONFIG.tiers];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">VIP Club Status</h3>
        <img src="/VIPs.png" alt="VIP Club" className="h-12" />
      </div>

      {/* Tier Status */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{tier.icon}</span>
            <span className="text-lg font-medium" style={{ color: tier.color }}>
              {tier.name}
            </span>
          </div>
          <Link
            href={`/loyalty/admin/members/${member.id}`}
            className="text-sm text-amber-600 hover:text-amber-700"
          >
            View Details →
          </Link>
        </div>
        
        {/* Points */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div>
            <p className="text-sm text-gray-600">Available</p>
            <p className="text-xl font-semibold text-gray-900">{member.availablePoints}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Lifetime</p>
            <p className="text-xl font-semibold text-gray-900">{member.lifetimePoints}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Events</p>
            <p className="text-xl font-semibold text-gray-900">{member.lifetimeEvents}</p>
          </div>
        </div>
      </div>

      {/* Progress to Next Tier */}
      {nextTier && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">Progress to {nextTier.name}</span>
            <span className="text-sm font-medium">
              {nextTier.minEvents - member.lifetimeEvents} events away
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${(member.lifetimeEvents / nextTier.minEvents) * 100}%`,
                backgroundColor: nextTier.color
              }}
            />
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Member since</span>
          <span className="font-medium">
            {new Date(member.joinDate).toLocaleDateString('en-GB', { 
              day: 'numeric', 
              month: 'short', 
              year: 'numeric' 
            })}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-600">Last visit</span>
          <span className="font-medium">
            {new Date(member.lastVisit).toLocaleDateString('en-GB', { 
              day: 'numeric', 
              month: 'short', 
              year: 'numeric' 
            })}
          </span>
        </div>
        {availableRewards.length > 0 && (
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-gray-600">Available rewards</span>
            <span className="font-medium text-amber-600">{availableRewards.length}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex space-x-3 mt-4">
        {hasPermission('loyalty', 'manage') && (
          <Link
            href={`/loyalty/admin/members/${member.id}/transactions`}
            className="text-sm text-amber-600 hover:text-amber-700"
          >
            View Transactions
          </Link>
        )}
        {hasPermission('loyalty', 'redeem') && (
          <Link
            href={`/loyalty/redeem?memberId=${member.id}`}
            className="text-sm text-amber-600 hover:text-amber-700"
          >
            Process Redemption
          </Link>
        )}
      </div>
    </div>
  );
}