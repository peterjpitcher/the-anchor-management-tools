'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import Link from 'next/link';
import { 
  ArrowLeftIcon,
  QrCodeIcon,
  UserPlusIcon,
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  CreditCardIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { processEventCheckIn, validateQRCode, getEventCheckIns } from '@/app/actions/loyalty-checkins';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Loader2 } from 'lucide-react';

type CheckInMethod = 'qr' | 'phone' | 'manual';
type CheckInState = 'idle' | 'scanning' | 'searching' | 'processing' | 'success' | 'error';

interface CheckInResult {
  check_in_id: string;
  points_earned: number;
  new_balance: number;
  lifetime_events: number;
  tierUpgraded?: boolean;
  oldTier?: string;
  newTier?: string;
  newAchievements?: Array<{
    id: string;
    name: string;
    message: string;
    icon: string;
    points_value: number;
  }>;
}

function CheckInPageContent() {
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const supabase = useSupabase();
  const [method, setMethod] = useState<CheckInMethod>('qr');
  const [state, setState] = useState<CheckInState>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [currentEvent, setCurrentEvent] = useState<any>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);
  const [recentCheckIns, setRecentCheckIns] = useState<any[]>([]);
  const [showScanner, setShowScanner] = useState(false);

  const eventId = searchParams.get('event');
  const bookingId = searchParams.get('booking');

  useEffect(() => {
    if (eventId) {
      loadEvent(eventId);
      loadRecentCheckIns(eventId);
    }
  }, [eventId]);

  const loadEvent = async (id: string) => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();
    
    if (data) {
      setCurrentEvent(data);
    }
  };

  const loadRecentCheckIns = async (eventId: string) => {
    const result = await getEventCheckIns(eventId);
    if (result.data) {
      setRecentCheckIns(result.data.slice(0, 5)); // Show last 5 check-ins
    }
  };

  const handleQRScan = async (data: string | null) => {
    if (!data || state === 'processing') return;
    
    setState('processing');
    setShowScanner(false);
    
    try {
      // Validate QR code
      const validation = await validateQRCode(data);
      
      if (validation.error) {
        toast.error(validation.error);
        setState('error');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      
      if (!validation.data) {
        toast.error('Invalid QR code');
        setState('error');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      
      // Process check-in
      const result = await processEventCheckIn({
        event_id: validation.data.event_id,
        customer_id: validation.data.customer_id,
        booking_id: validation.data.booking.id,
        check_in_method: 'qr'
      });
      
      if (result.error) {
        toast.error(result.error);
        setState('error');
        setTimeout(() => setState('idle'), 3000);
      } else if (result.data) {
        setCheckInResult(result.data);
        setState('success');
        await loadRecentCheckIns(validation.data.event_id);
        toast.success(`Checked in! ${result.data.points_earned} points awarded`);
      }
    } catch (error) {
      toast.error('Failed to process QR code');
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const searchCustomers = async () => {
    if (!searchQuery.trim()) return;
    
    setState('searching');
    
    try {
      let query = supabase
        .from('customers')
        .select(`
          *,
          loyalty_members!inner(
            id,
            available_points,
            lifetime_events,
            tier:loyalty_tiers(name, color, icon)
          )
        `);
      
      // Search by phone or name
      if (searchQuery.match(/^\d/)) {
        // Starts with digit - assume phone number
        query = query.ilike('phone_number', `%${searchQuery}%`);
      } else {
        // Search by name
        query = query.ilike('name', `%${searchQuery}%`);
      }
      
      const { data, error } = await query.limit(10);
      
      if (error) throw error;
      
      setCustomers(data || []);
      setState('idle');
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Failed to search customers');
      setState('idle');
    }
  };

  const handleManualCheckIn = async (customer: any) => {
    if (!eventId || state === 'processing') return;
    
    setState('processing');
    setSelectedCustomer(customer);
    
    try {
      const result = await processEventCheckIn({
        event_id: eventId,
        customer_id: customer.id,
        booking_id: bookingId || undefined,
        check_in_method: 'manual'
      });
      
      if (result.error) {
        toast.error(result.error);
        setState('error');
        setTimeout(() => setState('idle'), 3000);
      } else if (result.data) {
        setCheckInResult(result.data);
        setState('success');
        await loadRecentCheckIns(eventId);
        toast.success(`Checked in ${customer.name}! ${result.data.points_earned} points awarded`);
      }
    } catch (error) {
      toast.error('Failed to process check-in');
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const resetState = () => {
    setState('idle');
    setCheckInResult(null);
    setSelectedCustomer(null);
    setSearchQuery('');
    setCustomers([]);
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to check in customers.</p>
      </div>
    );
  }

  if (!eventId) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Select an Event</h1>
          <p className="text-gray-600 mb-8">Please select an event from the events page to start checking in customers.</p>
          <Link
            href="/events"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
          >
            Go to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-4">
          <Link
            href={`/events/${eventId}`}
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-1" />
            Back to Event
          </Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-4">Event Check-In</h1>
        {currentEvent && (
          <p className="mt-2 text-sm sm:text-base text-gray-600">
            {currentEvent.title} - {new Date(currentEvent.start_date).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">
        {/* Check-in Methods */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          {/* Method Selection */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Check-In Method</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <button
                onClick={() => setMethod('qr')}
                className={`p-3 sm:p-4 rounded-lg border-2 transition-colors min-h-[60px] sm:min-h-[80px] ${
                  method === 'qr' 
                    ? 'border-amber-500 bg-amber-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex sm:flex-col items-center sm:items-center justify-center">
                  <QrCodeIcon className="h-6 w-6 sm:h-8 sm:w-8 mb-0 sm:mb-2 mr-2 sm:mr-0 text-gray-700" />
                  <p className="text-sm font-medium">QR Code</p>
                </div>
              </button>
              
              <button
                onClick={() => setMethod('phone')}
                className={`p-3 sm:p-4 rounded-lg border-2 transition-colors min-h-[60px] sm:min-h-[80px] ${
                  method === 'phone' 
                    ? 'border-amber-500 bg-amber-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex sm:flex-col items-center sm:items-center justify-center">
                  <PhoneIcon className="h-6 w-6 sm:h-8 sm:w-8 mb-0 sm:mb-2 mr-2 sm:mr-0 text-gray-700" />
                  <p className="text-sm font-medium">Phone Number</p>
                </div>
              </button>
              
              <button
                onClick={() => setMethod('manual')}
                className={`p-3 sm:p-4 rounded-lg border-2 transition-colors min-h-[60px] sm:min-h-[80px] ${
                  method === 'manual' 
                    ? 'border-amber-500 bg-amber-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex sm:flex-col items-center sm:items-center justify-center">
                  <UserPlusIcon className="h-6 w-6 sm:h-8 sm:w-8 mb-0 sm:mb-2 mr-2 sm:mr-0 text-gray-700" />
                  <p className="text-sm font-medium">Manual Search</p>
                </div>
              </button>
            </div>
          </div>

          {/* Check-in Interface */}
          <div className="bg-white shadow rounded-lg p-6">
            {state === 'success' && checkInResult ? (
              <div className="text-center py-6 sm:py-8">
                <CheckCircleIcon className="h-12 w-12 sm:h-16 sm:w-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Check-In Successful!</h3>
                <div className="mb-4">
                  <p className="text-sm sm:text-base text-gray-600">
                    {checkInResult.points_earned} points awarded
                  </p>
                  {((checkInResult.newAchievements && checkInResult.newAchievements.length > 0) || checkInResult.tierUpgraded) && (
                    <div className="flex items-center justify-center mt-2">
                      <SparklesIcon className="h-5 w-5 text-purple-600 mr-1" />
                      <p className="text-sm font-medium text-purple-600">
                        {checkInResult.tierUpgraded && checkInResult.newAchievements && checkInResult.newAchievements.length > 0
                          ? 'Tier upgraded & achievements unlocked!'
                          : checkInResult.tierUpgraded
                          ? 'Tier upgraded!'
                          : `${checkInResult.newAchievements!.length} achievement${checkInResult.newAchievements!.length > 1 ? 's' : ''} unlocked!`
                        }
                      </p>
                    </div>
                  )}
                </div>
                
                {checkInResult.tierUpgraded && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 max-w-sm mx-auto">
                    <div className="flex items-center">
                      <svg className="h-8 w-8 text-amber-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      <div>
                        <p className="font-semibold text-amber-900">Tier Upgraded!</p>
                        <p className="text-sm text-amber-700">
                          {checkInResult.oldTier} → {checkInResult.newTier}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {checkInResult.newAchievements && checkInResult.newAchievements.length > 0 && (
                  <div className="mb-4 max-w-md mx-auto">
                    <h4 className="text-lg font-semibold text-gray-900 mb-3 text-center">New Achievements Unlocked!</h4>
                    <div className="space-y-2">
                      {checkInResult.newAchievements.map((achievement) => (
                        <div key={achievement.id} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <div className="flex items-start">
                            <span className="text-2xl mr-3">{achievement.icon}</span>
                            <div className="flex-1">
                              <p className="font-semibold text-purple-900">{achievement.name}</p>
                              <p className="text-sm text-purple-700">{achievement.message}</p>
                              {achievement.points_value > 0 && (
                                <p className="text-xs text-purple-600 mt-1">+{achievement.points_value} bonus points</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="bg-gray-50 rounded-lg p-4 mb-6 max-w-sm mx-auto">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">New Balance:</span>
                    <span className="font-semibold">{checkInResult.new_balance} points</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Total Events:</span>
                    <span className="font-semibold">{checkInResult.lifetime_events}</span>
                  </div>
                </div>
                <button
                  onClick={resetState}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
                >
                  Check In Another Customer
                </button>
              </div>
            ) : state === 'error' ? (
              <div className="text-center py-8">
                <XCircleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Check-In Failed</h3>
                <p className="text-gray-600 mb-4">Please try again</p>
              </div>
            ) : (
              <>
                {method === 'qr' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Scan QR Code</h3>
                    {showScanner ? (
                      <div>
                        <div className="relative aspect-square sm:aspect-video max-w-md mx-auto mb-4">
                          <video id="qr-video" className="w-full h-full rounded-lg object-cover" />
                        </div>
                        <button
                          onClick={() => {
                            setShowScanner(false);
                            const video = document.getElementById('qr-video') as HTMLVideoElement;
                            if (video && video.srcObject) {
                              const stream = video.srcObject as MediaStream;
                              stream.getTracks().forEach(track => track.stop());
                            }
                          }}
                          className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 min-h-[44px]"
                        >
                          Cancel Scanning
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={async () => {
                          setShowScanner(true);
                          const codeReader = new BrowserQRCodeReader();
                          try {
                            const result = await codeReader.decodeFromVideoDevice(
                              undefined,
                              'qr-video',
                              (result, err) => {
                                if (result) {
                                  handleQRScan(result.getText());
                                  // Note: Cannot reset reader in continuous decode mode
                                }
                              }
                            );
                          } catch (err) {
                            console.error('QR scan error:', err);
                            toast.error('Failed to start camera');
                            setShowScanner(false);
                          }
                        }}
                        className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-sm sm:text-base font-medium text-white bg-amber-600 hover:bg-amber-700 min-h-[44px]"
                      >
                        <QrCodeIcon className="h-5 w-5 mr-2" />
                        Start Scanner
                      </button>
                    )}
                  </div>
                )}

                {(method === 'phone' || method === 'manual') && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Search {method === 'phone' ? 'by Phone Number' : 'Customers'}
                    </h3>
                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && searchCustomers()}
                          placeholder={method === 'phone' ? 'Enter phone number...' : 'Search by name or phone...'}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 px-3 py-2 min-h-[44px]"
                        />
                      </div>
                      <button
                        onClick={searchCustomers}
                        disabled={state === 'searching'}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 min-h-[44px]"
                      >
                        {state === 'searching' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MagnifyingGlassIcon className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {/* Search Results */}
                    {customers.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {customers.map(customer => (
                          <div
                            key={customer.id}
                            className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer min-h-[80px]"
                            onClick={() => handleManualCheckIn(customer)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{customer.name}</p>
                                <p className="text-sm text-gray-500">{customer.phone_number}</p>
                                {customer.loyalty_members?.[0] && (
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="text-xs px-2 py-1 rounded-full" style={{
                                      backgroundColor: `${customer.loyalty_members[0].tier?.color}20`,
                                      color: customer.loyalty_members[0].tier?.color
                                    }}>
                                      {customer.loyalty_members[0].tier?.icon} {customer.loyalty_members[0].tier?.name}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {customer.loyalty_members[0].available_points} points
                                    </span>
                                  </div>
                                )}
                              </div>
                              <button
                                disabled={state === 'processing'}
                                className="text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap px-2 py-1"
                              >
                                Check In →
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {state === 'idle' && searchQuery && customers.length === 0 && (
                      <p className="mt-4 text-center text-gray-500">No customers found</p>
                    )}
                  </div>
                )}

                {state === 'processing' && (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-amber-600" />
                    <p className="text-gray-600">Processing check-in...</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Recent Check-ins */}
        <div className="lg:col-span-1 order-1 lg:order-2">
          <div className="bg-white shadow rounded-lg p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Check-Ins</h3>
            {recentCheckIns.length > 0 ? (
              <div className="space-y-3">
                {recentCheckIns.map(checkIn => (
                  <div key={checkIn.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {checkIn.customer?.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(checkIn.check_in_time).toLocaleTimeString('en-GB', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-green-600">
                        +{checkIn.points_earned}
                      </p>
                      <p className="text-xs text-gray-500">
                        {checkIn.check_in_method}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No check-ins yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    }>
      <CheckInPageContent />
    </Suspense>
  );
}