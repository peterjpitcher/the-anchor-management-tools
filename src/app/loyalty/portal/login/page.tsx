'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, PhoneIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { requestLoyaltyOTP, verifyLoyaltyOTP } from '@/app/actions/loyalty-otp';
import { Loader2 } from 'lucide-react';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

type LoginState = 'phone' | 'otp' | 'loading';

export default function LoyaltyPortalLoginPage() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');

    try {
      const result = await requestLoyaltyOTP({ phoneNumber });
      
      if (result.error) {
        toast.error(result.error);
        setState('phone');
        return;
      }

      if (result.success && result.maskedPhone) {
        setMaskedPhone(result.maskedPhone);
        setState('otp');
        toast.success('Verification code sent!');
      }
    } catch (error) {
      toast.error('Failed to send verification code');
      setState('phone');
    }
  };

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');

    try {
      const result = await verifyLoyaltyOTP({ phoneNumber, otpCode });
      
      if (result.error) {
        toast.error(result.error);
        setState('otp');
        return;
      }

      if (result.success && result.sessionToken) {
        // Store session token in cookie
        document.cookie = `loyalty_session=${result.sessionToken}; path=/; max-age=${24 * 60 * 60}; samesite=strict`;
        
        toast.success('Welcome to your VIP portal!');
        router.push('/loyalty/portal');
      }
    } catch (error) {
      toast.error('Failed to verify code');
      setState('otp');
    }
  };

  const handleResendOTP = async () => {
    setState('loading');
    
    try {
      const result = await requestLoyaltyOTP({ phoneNumber });
      
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('New verification code sent!');
      }
    } catch (error) {
      toast.error('Failed to send verification code');
    }
    
    setState('otp');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Logo and Header */}
          <div className="text-center mb-8">
            <div className="mb-6">
              <VIPClubLogo size="medium" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              VIP Member Portal
            </h1>
            <p className="text-gray-600">
              Access your rewards and benefits
            </p>
          </div>

          {state === 'loading' && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-amber-600" />
              <p className="text-gray-600">Please wait...</p>
            </div>
          )}

          {state === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <PhoneIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="tel"
                    id="phone"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full pl-10 pr-3 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                    placeholder="07700 900123"
                    required
                    autoFocus
                  />
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Enter the phone number linked to your VIP membership
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Send Verification Code
              </button>

              <div className="text-center">
                <Link
                  href="/loyalty"
                  className="text-sm text-amber-600 hover:text-amber-700"
                >
                  <span className="inline-flex items-center">
                    <ArrowLeftIcon className="h-4 w-4 mr-1" />
                    Back to loyalty page
                  </span>
                </Link>
              </div>
            </form>
          )}

          {state === 'otp' && (
            <form onSubmit={handleOTPSubmit} className="space-y-6">
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                  Verification Code
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="otp"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-10 pr-3 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-2xl font-mono text-center tracking-wider"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  We sent a 6-digit code to {maskedPhone}
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Verify & Login
              </button>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setState('phone');
                    setOtpCode('');
                  }}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Change number
                </button>
                <button
                  type="button"
                  onClick={handleResendOTP}
                  className="text-sm text-amber-600 hover:text-amber-700"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {/* Security Notice */}
          <div className="mt-8 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 text-center">
              🔒 Your phone number is used for secure authentication only. 
              We'll never share your information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}