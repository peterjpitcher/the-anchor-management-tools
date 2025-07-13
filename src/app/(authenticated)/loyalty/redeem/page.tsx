'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import Link from 'next/link';
import { 
  ArrowLeftIcon,
  QrCodeIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  GiftIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { processRedemption, validateRedemptionCode, getPendingRedemptions } from '@/app/actions/loyalty-redemptions';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Loader2 } from 'lucide-react';

type RedemptionState = 'input' | 'scanning' | 'checking' | 'success' | 'error' | 'expired' | 'already-used';

interface RedemptionResult {
  redemption_id: string;
  reward_name: string;
  reward_description: string;
  member_name: string;
  member_tier: string;
  points_spent: number;
}

export default function RedemptionPage() {
  const { hasPermission } = usePermissions();
  const supabase = useSupabase();
  const [state, setState] = useState<RedemptionState>('input');
  const [code, setCode] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [redemptionResult, setRedemptionResult] = useState<RedemptionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingRedemptions, setPendingRedemptions] = useState<any[]>([]);

  useEffect(() => {
    loadPendingRedemptions();
  }, []);

  const loadPendingRedemptions = async () => {
    const result = await getPendingRedemptions();
    if (result.data) {
      setPendingRedemptions(result.data);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    await processCode(code);
  };

  const processCode = async (redemptionCode: string) => {
    setState('checking');
    setErrorMessage('');
    
    try {
      // Validate the code
      const validation = await validateRedemptionCode(redemptionCode);
      
      if (validation.error) {
        setErrorMessage(validation.error);
        setState(validation.error.includes('expired') ? 'expired' : 
                 validation.error.includes('already') ? 'already-used' : 'error');
        return;
      }
      
      if (!validation.data) {
        setErrorMessage('Invalid redemption code');
        setState('error');
        return;
      }
      
      // Process the redemption
      const result = await processRedemption(validation.data.redemption_id);
      
      if (result.error) {
        setErrorMessage(result.error);
        setState('error');
        return;
      }
      
      if (result.data) {
        setRedemptionResult(result.data);
        setState('success');
        await loadPendingRedemptions();
        toast.success('Redemption processed successfully!');
      }
    } catch (error) {
      console.error('Redemption error:', error);
      setErrorMessage('Failed to process redemption');
      setState('error');
    }
  };

  const handleQRScan = async () => {
    setShowScanner(true);
    const codeReader = new BrowserQRCodeReader();
    
    try {
      await codeReader.decodeFromVideoDevice(
        undefined,
        'qr-video',
        (result, err) => {
          if (result) {
            const text = result.getText();
            // Note: Cannot reset reader in continuous decode mode
            setShowScanner(false);
            
            // Extract redemption code from QR data
            try {
              const qrData = JSON.parse(text);
              if (qrData.type === 'loyalty_redemption' && qrData.code) {
                processCode(qrData.code);
              } else {
                toast.error('Invalid QR code format');
              }
            } catch {
              // Try using the text directly as a code
              processCode(text);
            }
          }
        }
      );
    } catch (err) {
      console.error('QR scan error:', err);
      toast.error('Failed to start camera');
      setShowScanner(false);
    }
  };

  const reset = () => {
    setState('input');
    setCode('');
    setRedemptionResult(null);
    setErrorMessage('');
    setShowScanner(false);
    
    // Stop camera if running
    const video = document.getElementById('qr-video') as HTMLVideoElement;
    if (video && video.srcObject) {
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const handlePendingRedemption = (redemption: any) => {
    processCode(redemption.code);
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to process redemptions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-4">
          <Link
            href="/loyalty/admin"
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-1" />
            Back
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mt-4">Redemption Terminal</h1>
        <p className="mt-2 text-gray-600">
          Process customer reward redemptions
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Redemption Interface */}
        <div className="lg:col-span-2">
          <div className="bg-white shadow rounded-lg p-6">
            {state === 'success' && redemptionResult ? (
              <div className="text-center py-8">
                <CheckCircleIcon className="h-20 w-20 text-green-500 mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-green-600 mb-2">VALID</h2>
                <p className="text-xl font-semibold text-gray-900 mb-4">
                  {redemptionResult.reward_name}
                </p>
                
                <div className="bg-green-50 rounded-lg p-6 mb-6 max-w-md mx-auto">
                  <p className="text-lg text-green-900 font-medium mb-2">
                    Serve the customer their reward:
                  </p>
                  <p className="text-green-700">
                    {redemptionResult.reward_description}
                  </p>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4 mb-6 max-w-md mx-auto">
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="text-gray-600">Customer:</span>{' '}
                      <span className="font-medium text-gray-900">{redemptionResult.member_name}</span>
                    </p>
                    <p>
                      <span className="text-gray-600">VIP Tier:</span>{' '}
                      <span className="font-medium text-gray-900">{redemptionResult.member_tier}</span>
                    </p>
                    <p>
                      <span className="text-gray-600">Points Used:</span>{' '}
                      <span className="font-medium text-gray-900">{redemptionResult.points_spent}</span>
                    </p>
                  </div>
                </div>
                
                <button
                  onClick={reset}
                  className="inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-gray-600 hover:bg-gray-700"
                >
                  Done - Next Customer
                </button>
              </div>
            ) : state === 'expired' ? (
              <div className="text-center py-8">
                <ClockIcon className="h-20 w-20 text-orange-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-orange-600 mb-2">Code Expired</h2>
                <p className="text-gray-600 mb-6">{errorMessage}</p>
                
                <div className="bg-orange-50 rounded-lg p-4 mb-6 max-w-md mx-auto">
                  <p className="text-orange-800">
                    Ask the customer to generate a new code from their loyalty portal.
                  </p>
                </div>
                
                <button
                  onClick={reset}
                  className="inline-flex items-center px-6 py-3 border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Try Another Code
                </button>
              </div>
            ) : state === 'already-used' ? (
              <div className="text-center py-8">
                <ExclamationTriangleIcon className="h-20 w-20 text-red-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-red-600 mb-2">Already Redeemed</h2>
                <p className="text-gray-600 mb-6">{errorMessage}</p>
                
                <div className="bg-red-50 rounded-lg p-4 mb-6 max-w-md mx-auto">
                  <p className="text-red-800">
                    Each code can only be used once. The customer needs to generate a new code for additional rewards.
                  </p>
                </div>
                
                <button
                  onClick={reset}
                  className="inline-flex items-center px-6 py-3 border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Try Another Code
                </button>
              </div>
            ) : state === 'error' ? (
              <div className="text-center py-8">
                <XCircleIcon className="h-20 w-20 text-red-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-red-600 mb-2">Invalid Code</h2>
                <p className="text-gray-600 mb-6">{errorMessage || 'Please check and try again'}</p>
                
                <button
                  onClick={reset}
                  className="inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-amber-600 hover:bg-amber-700"
                >
                  Try Again
                </button>
              </div>
            ) : state === 'checking' ? (
              <div className="text-center py-8">
                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-amber-600" />
                <p className="text-gray-600">Validating code...</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Enter Redemption Code</h3>
                
                {showScanner ? (
                  <div>
                    <video id="qr-video" className="w-full rounded-lg mb-4" />
                    <button
                      onClick={() => {
                        setShowScanner(false);
                        const video = document.getElementById('qr-video') as HTMLVideoElement;
                        if (video && video.srcObject) {
                          const stream = video.srcObject as MediaStream;
                          stream.getTracks().forEach(track => track.stop());
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Cancel Scanning
                    </button>
                  </div>
                ) : (
                  <>
                    <form onSubmit={handleCodeSubmit} className="space-y-4">
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
                          placeholder="ABC1234"
                          pattern="[A-Z0-9]+"
                          maxLength={10}
                          required
                          autoComplete="off"
                          autoFocus
                        />
                      </div>
                      
                      <button
                        type="submit"
                        className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-amber-600 hover:bg-amber-700"
                      >
                        Redeem Code
                      </button>
                    </form>
                    
                    <div className="relative my-6">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-300"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-white text-gray-500">OR</span>
                      </div>
                    </div>
                    
                    <button
                      onClick={handleQRScan}
                      className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <QrCodeIcon className="h-5 w-5 mr-2" />
                      Scan QR Code
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pending Redemptions */}
        <div className="lg:col-span-1">
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <GiftIcon className="h-5 w-5 mr-2 text-amber-600" />
              Pending Redemptions
            </h3>
            
            {pendingRedemptions.length > 0 ? (
              <div className="space-y-3">
                {pendingRedemptions.map(redemption => (
                  <div
                    key={redemption.id}
                    className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                    onClick={() => handlePendingRedemption(redemption)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {redemption.reward?.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {redemption.member?.customer?.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Code: <span className="font-mono">{redemption.code}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {new Date(redemption.created_at).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4 text-sm">
                No pending redemptions
              </p>
            )}
          </div>
          
          <div className="bg-blue-50 rounded-lg p-4 mt-4">
            <p className="text-sm text-blue-800">
              💡 Customers can show their redemption code or QR from their phone. QR scanning is instant!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}