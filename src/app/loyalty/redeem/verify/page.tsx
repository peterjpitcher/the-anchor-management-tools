'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { activeRedemptionCodes, rewards, mockMembers } from '@/lib/mock-data/loyalty-demo';

function VerifyRedemptionContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [redemptionDetails, setRedemptionDetails] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [redeemed, setRedeemed] = useState(false);

  useEffect(() => {
    // Get the QR data from URL params
    const data = searchParams.get('data');
    if (!data) {
      setError('Invalid QR code');
      setLoading(false);
      return;
    }

    try {
      const qrData = JSON.parse(decodeURIComponent(data));
      validateCode(qrData);
    } catch (e) {
      setError('Invalid QR code format');
      setLoading(false);
    }
  }, [searchParams]);

  const validateCode = async (qrData: any) => {
    setLoading(true);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { code, customerId } = qrData;
    
    // Find the code
    const redemptionCode = activeRedemptionCodes.find(
      rc => rc.code === code && rc.memberId === customerId
    );
    
    if (!redemptionCode) {
      setError('Invalid or expired code');
      setLoading(false);
      return;
    }
    
    // Check if already used
    if (redemptionCode.used) {
      setError('This code has already been redeemed');
      setLoading(false);
      return;
    }
    
    // Check if expired
    const expiresAt = new Date(redemptionCode.expiresAt);
    if (expiresAt < new Date()) {
      const minutesAgo = Math.floor((new Date().getTime() - expiresAt.getTime()) / 60000);
      setError(`This code expired ${minutesAgo} minutes ago`);
      setLoading(false);
      return;
    }
    
    // Find reward and member details
    const reward = rewards.find(r => r.id === redemptionCode.rewardId);
    const member = Object.values(mockMembers).find(m => m.id === redemptionCode.memberId);
    
    setRedemptionDetails({
      code: redemptionCode,
      reward,
      member
    });
    setLoading(false);
  };

  const handleRedeem = async () => {
    if (!redemptionDetails) return;
    
    setLoading(true);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mark as used
    redemptionDetails.code.used = true;
    redemptionDetails.code.usedAt = new Date().toISOString();
    
    setRedeemed(true);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Validating code...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">❌</div>
              <h1 className="text-3xl font-bold text-red-600 mb-2">Invalid Code</h1>
              <p className="text-gray-600">{error}</p>
            </div>
            
            <button
              onClick={() => window.location.href = '/loyalty/redeem'}
              className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Back to Redemption Terminal
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (redeemed) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">✅</div>
              <h1 className="text-3xl font-bold text-green-600 mb-2">Redeemed!</h1>
              <p className="text-xl text-gray-900">{redemptionDetails.reward.name}</p>
            </div>
            
            <div className="bg-green-50 rounded-lg p-4 mb-6">
              <p className="text-green-800 text-center font-medium">
                Serve the customer their reward
              </p>
            </div>
            
            <button
              onClick={() => window.location.href = '/loyalty/redeem'}
              className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Done - Next Customer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (redemptionDetails) {
    const { reward, member } = redemptionDetails;
    const timeLeft = Math.floor((new Date(redemptionDetails.code.expiresAt).getTime() - new Date().getTime()) / 1000);
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-4">Verify Redemption</h1>
              
              {/* Reward Info */}
              <div className="bg-amber-50 rounded-lg p-6 mb-6">
                <div className="text-4xl mb-3">{reward.icon}</div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{reward.name}</h2>
                <p className="text-gray-600">{reward.description}</p>
              </div>
              
              {/* Customer Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
                <h3 className="font-semibold text-gray-900 mb-2">Customer Details</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="text-gray-600">Name:</span> <span className="font-medium">{member.customerName}</span></p>
                  <p><span className="text-gray-600">Phone:</span> <span className="font-medium">{member.phoneNumber}</span></p>
                  <p><span className="text-gray-600">Tier:</span> <span className="font-medium uppercase">{member.tier}</span></p>
                  <p><span className="text-gray-600">Code:</span> <span className="font-mono font-medium">{redemptionDetails.code.code}</span></p>
                </div>
              </div>
              
              {/* Timer */}
              <div className="mb-6">
                <p className={`text-lg font-medium ${timeLeft < 60 ? 'text-red-600' : 'text-gray-700'}`}>
                  ⏱️ Expires in: {minutes}:{seconds.toString().padStart(2, '0')}
                </p>
              </div>
              
              {/* Actions */}
              <div className="space-y-3">
                <button
                  onClick={handleRedeem}
                  className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-green-700 transition-colors"
                >
                  Confirm & Redeem
                </button>
                <button
                  onClick={() => window.location.href = '/loyalty/redeem'}
                  className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function VerifyRedemptionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <VerifyRedemptionContent />
    </Suspense>
  );
}