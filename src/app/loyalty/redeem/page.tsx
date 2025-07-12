'use client';

import { useState } from 'react';
import { activeRedemptionCodes, rewards, mockMembers } from '@/lib/mock-data/loyalty-demo';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

type RedemptionState = 'input' | 'checking' | 'success' | 'error' | 'expired' | 'already-used';

export default function StaffRedeemPage() {
  const [code, setCode] = useState('');
  const [state, setState] = useState<RedemptionState>('input');
  const [redemptionDetails, setRedemptionDetails] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('checking');
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Find the code
    const redemptionCode = activeRedemptionCodes.find(
      rc => rc.code.toUpperCase() === code.toUpperCase()
    );
    
    if (!redemptionCode) {
      setErrorMessage('Invalid code');
      setState('error');
      return;
    }
    
    // Check if already used
    if (redemptionCode.used) {
      setState('already-used');
      setRedemptionDetails(redemptionCode);
      return;
    }
    
    // Check if expired
    const expiresAt = new Date(redemptionCode.expiresAt);
    if (expiresAt < new Date()) {
      setState('expired');
      const minutesAgo = Math.floor((new Date().getTime() - expiresAt.getTime()) / 60000);
      setErrorMessage(`This code expired ${minutesAgo} minutes ago`);
      return;
    }
    
    // Find reward and member details
    const reward = rewards.find(r => r.id === redemptionCode.rewardId);
    const member = Object.values(mockMembers).find(m => m.id === redemptionCode.memberId);
    
    // Mark as used
    redemptionCode.used = true;
    redemptionCode.usedAt = new Date().toISOString();
    
    setRedemptionDetails({
      code: redemptionCode,
      reward,
      member
    });
    setState('success');
  };

  const reset = () => {
    setCode('');
    setState('input');
    setRedemptionDetails(null);
    setErrorMessage('');
  };

  if (state === 'input') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-8">
              <div className="mb-6">
                <VIPClubLogo size="small" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Redemption Terminal</h1>
              <p className="text-gray-600">Enter or scan customer's redemption code</p>
            </div>
            
            <form onSubmit={handleRedeem} className="space-y-6">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                  Redemption Code
                </label>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-2xl font-mono text-center uppercase"
                  placeholder="DES1234"
                  pattern="[A-Z]{3}[0-9]{4}"
                  maxLength={7}
                  required
                  autoComplete="off"
                  autoFocus
                />
              </div>
              
              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Redeem Code
              </button>
            </form>
            
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-500">OR</span>
                </div>
              </div>
              
              <button
                onClick={() => alert('QR scanner would open here - in production this would use the device camera to scan customer QR codes')}
                className="mt-6 w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
              >
                <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2L5 6v2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 4h2a1 1 0 011 1v2M5 20h2a1 1 0 001-1v-2M19 4h-2a1 1 0 00-1 1v2M19 20h-2a1 1 0 01-1-1v-2" />
                </svg>
                Scan QR Code
              </button>
            </div>
            
            <div className="mt-8 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 Customer can show their code or QR from their phone. QR scanning is instant!
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Validating code...</p>
        </div>
      </div>
    );
  }

  if (state === 'success' && redemptionDetails) {
    const { reward, member } = redemptionDetails;
    
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">✅</div>
              <h1 className="text-3xl font-bold text-green-600 mb-2">VALID</h1>
              <p className="text-xl font-semibold text-gray-900">{reward.name}</p>
            </div>
            
            <div className="bg-green-50 rounded-lg p-6 mb-6">
              <p className="text-center text-lg text-green-900 font-medium">
                Serve the customer their reward
              </p>
              <p className="text-center text-green-700 mt-2">
                {reward.description}
              </p>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-600 text-center">
                Customer: <span className="font-medium text-gray-900">{member.customerName}</span>
              </p>
              <p className="text-sm text-gray-600 text-center mt-1">
                VIP Status: <span className="font-medium text-gray-900">{member.tier.toUpperCase()}</span>
              </p>
            </div>
            
            <button
              onClick={reset}
              className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Done - Next Customer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">❌</div>
              <h1 className="text-3xl font-bold text-red-600 mb-2">Code Expired</h1>
              <p className="text-gray-600">{errorMessage}</p>
            </div>
            
            <div className="bg-red-50 rounded-lg p-4 mb-6">
              <p className="text-red-800">
                Ask customer to generate a new code from their loyalty dashboard.
              </p>
            </div>
            
            <button
              onClick={reset}
              className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Try Another Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'already-used') {
    const usedAt = new Date(redemptionDetails.usedAt);
    const timeAgo = Math.floor((new Date().getTime() - usedAt.getTime()) / 60000);
    
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">❌</div>
              <h1 className="text-3xl font-bold text-red-600 mb-2">Already Redeemed</h1>
              <p className="text-gray-600">
                This code was used {timeAgo} minute{timeAgo !== 1 ? 's' : ''} ago
              </p>
            </div>
            
            <div className="bg-red-50 rounded-lg p-4 mb-6">
              <p className="text-red-800">
                Each code can only be used once. Customer needs to generate a new code for additional rewards.
              </p>
            </div>
            
            <button
              onClick={reset}
              className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Try Another Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">❌</div>
              <h1 className="text-3xl font-bold text-red-600 mb-2">Invalid Code</h1>
              <p className="text-gray-600">Please check and try again</p>
            </div>
            
            <div className="bg-orange-50 rounded-lg p-4 mb-6">
              <p className="text-orange-800">
                Make sure you're entering the code exactly as shown on the customer's phone.
              </p>
            </div>
            
            <button
              onClick={reset}
              className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-amber-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}