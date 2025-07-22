'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { requestLoyaltyOTP, verifyLoyaltyOTP } from '@/app/actions/loyalty-otp';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';
import { Page } from '@/components/ui-v2/layout/Page';
import { Container } from '@/components/ui-v2/layout/Container';
import { Card } from '@/components/ui-v2/layout/Card';
import { Input } from '@/components/ui-v2/forms/Input';
import { Button } from '@/components/ui-v2/forms/Button';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';

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
    <Page title="VIP Club Login" className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
      <Container size="sm">
        <Card className="p-8">
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
              <Spinner size="lg" className="mx-auto mb-4 text-amber-600" />
              <p className="text-gray-600">Please wait...</p>
            </div>
          )}

          {state === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <FormGroup
                label="Phone Number"
                htmlFor="phone"
                help="Enter the phone number linked to your VIP membership"
              >
                <Input
                  type="tel"
                  id="phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  leftIcon={<PhoneIcon className="h-5 w-5" />}
                  placeholder="07700 900123"
                  inputSize="lg"
                  required
                  autoFocus
                />
              </FormGroup>

              <Button
                type="submit"
                fullWidth
                size="lg"
                variant="primary"
                className="bg-amber-600 hover:bg-amber-700"
              >
                Send Verification Code
              </Button>

              <div className="text-center">
                <LinkButton
                  href="/loyalty"
                  variant="link"
                  className="text-amber-600 hover:text-amber-700"
                >
                  Back to loyalty page
                </LinkButton>
              </div>
            </form>
          )}

          {state === 'otp' && (
            <form onSubmit={handleOTPSubmit} className="space-y-6">
              <FormGroup
                label="Verification Code"
                htmlFor="otp"
                help={`We sent a 6-digit code to ${maskedPhone}`}
              >
                <Input
                  type="text"
                  id="otp"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  leftIcon={<ShieldCheckIcon className="h-5 w-5" />}
                  placeholder="000000"
                  inputSize="lg"
                  maxLength={6}
                  required
                  autoFocus
                  className="font-mono text-center tracking-wider"
                />
              </FormGroup>

              <Button
                type="submit"
                fullWidth
                size="lg"
                variant="primary"
                className="bg-amber-600 hover:bg-amber-700"
              >
                Verify & Login
              </Button>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  onClick={() => {
                    setState('phone');
                    setOtpCode('');
                  }}
                  variant="link"
                  size="sm"
                >
                  Change number
                </Button>
                <Button
                  type="button"
                  onClick={handleResendOTP}
                  variant="link"
                  size="sm"
                  className="text-amber-600 hover:text-amber-700"
                >
                  Resend code
                </Button>
              </div>
            </form>
          )}

          {/* Security Notice */}
          <Card variant="bordered" className="mt-8">
            <p className="text-xs text-gray-600 text-center">
              🔒 Your phone number is used for secure authentication only. 
              We&apos;ll never share your information.
            </p>
          </Card>
        </Card>
      </Container>
    </Page>
  );
}