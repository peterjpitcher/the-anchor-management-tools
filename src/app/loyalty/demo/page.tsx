'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useState, useEffect } from 'react';
import { todaysEvent } from '@/lib/mock-data/loyalty-demo';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

export default function LoyaltyDemoPage() {
  const [eventQrUrl, setEventQrUrl] = useState<string>('');

  useEffect(() => {
    // Generate event QR code
    const generateQR = async () => {
      const checkInUrl = `${window.location.origin}/loyalty/checkin?event=${todaysEvent.id}`;
      const qrUrl = await QRCode.toDataURL(checkInUrl, {
        width: 200,
        margin: 2
      });
      setEventQrUrl(qrUrl);
    };
    generateQR();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="mb-6">
            <VIPClubLogo size="large" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Loyalty System Demo
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Experience our complete loyalty system demo. Test customer check-ins, 
            view the loyalty dashboard, and process reward redemptions.
          </p>
        </div>

        {/* Demo Notice */}
        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-6 mb-8">
          <p className="text-amber-800 text-center">
            🎭 <strong>Demo Mode:</strong> This is a fully functional demo with mock data. 
            No real customer data or database changes are made.
          </p>
        </div>

        {/* Today's Event */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Today&apos;s Event</h2>
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-lg font-medium text-gray-900">{todaysEvent.name}</p>
              <p className="text-gray-600">
                {new Date(todaysEvent.date).toLocaleDateString('en-GB', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'long' 
                })}
              </p>
              <p className="text-gray-600">{todaysEvent.startTime} - {todaysEvent.endTime}</p>
              
              <div className="mt-6">
                <h3 className="font-semibold text-gray-900 mb-2">Test Phone Numbers:</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Sarah (Silver): <code className="bg-gray-100 px-2 py-1 rounded">07700900001</code></li>
                  <li>• Mike (Bronze): <code className="bg-gray-100 px-2 py-1 rounded">07700900002</code></li>
                  <li>• Emma (Gold): <code className="bg-gray-100 px-2 py-1 rounded">07700900003</code></li>
                </ul>
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-3">Event Check-in QR Code</p>
              {eventQrUrl && (
                <img src={eventQrUrl} alt="Event QR Code" className="mx-auto" />
              )}
              <p className="text-xs text-gray-500 mt-2">Scan to check in to tonight&apos;s event</p>
            </div>
          </div>
        </div>

        {/* Demo Sections */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Customer Check-in */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center mb-4">
              <div className="text-4xl mb-3">📱</div>
              <h3 className="text-xl font-bold text-gray-900">Customer Check-in</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Customers scan the event QR code and check themselves in. 
              They earn points and unlock achievements automatically.
            </p>
            <Link
              href="/loyalty/checkin"
              className="block w-full bg-amber-600 text-white text-center py-3 px-4 rounded-lg font-medium hover:bg-amber-700 transition-colors"
            >
              Test Check-in Flow
            </Link>
          </div>

          {/* Customer Dashboard */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center mb-4">
              <div className="text-4xl mb-3">🏆</div>
              <h3 className="text-xl font-bold text-gray-900">Loyalty Dashboard</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Customers view their points, achievements, and redeem rewards. 
              Features a 5-minute timer for secure redemptions.
            </p>
            <Link
              href="/loyalty?phone=07700900001"
              className="block w-full bg-purple-600 text-white text-center py-3 px-4 rounded-lg font-medium hover:bg-purple-700 transition-colors"
            >
              View Customer Dashboard
            </Link>
          </div>

          {/* Staff Terminal */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center mb-4">
              <div className="text-4xl mb-3">🏪</div>
              <h3 className="text-xl font-bold text-gray-900">Staff Terminal</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Staff can process redemptions by entering codes or scanning 
              customer QR codes. Shows reward details and customer info.
            </p>
            <Link
              href="/loyalty/redeem"
              className="block w-full bg-green-600 text-white text-center py-3 px-4 rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Open Redemption Terminal
            </Link>
          </div>
        </div>

        {/* Additional Features */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Additional Features</h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">🎯 Key Features Demonstrated</h3>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Self-service check-in via QR codes</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Automatic point allocation based on tier</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Achievement system with instant rewards</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>5-minute redemption codes for security</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>QR code redemptions for faster service</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Tier-based benefits and multipliers</span>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">🎪 Event QR Generation</h3>
              <p className="text-gray-600 mb-4">
                In the full system, staff can generate and print QR codes for each event:
              </p>
              <Link
                href="/loyalty/event-qr"
                className="inline-flex items-center text-amber-600 hover:text-amber-700 font-medium"
              >
                View QR Code Generator
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        {/* Demo Flow Guide */}
        <div className="mt-12 bg-blue-50 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Demo Flow Guide</h2>
          
          <ol className="space-y-4 text-gray-700">
            <li className="flex items-start">
              <span className="font-bold text-blue-600 mr-3">1.</span>
              <div>
                <strong>Customer Check-in:</strong> Go to <code className="bg-white px-2 py-1 rounded">/loyalty/checkin</code> 
                and enter one of the test phone numbers. You&apos;ll see the check-in success screen with points earned.
              </div>
            </li>
            <li className="flex items-start">
              <span className="font-bold text-blue-600 mr-3">2.</span>
              <div>
                <strong>View Dashboard:</strong> Visit the loyalty dashboard to see points, achievements, and rewards. 
                Try generating a redemption code.
              </div>
            </li>
            <li className="flex items-start">
              <span className="font-bold text-blue-600 mr-3">3.</span>
              <div>
                <strong>Redeem Reward:</strong> Copy the code (or scan the QR) and use the staff terminal to 
                process the redemption. Note the 5-minute timer!
              </div>
            </li>
            <li className="flex items-start">
              <span className="font-bold text-blue-600 mr-3">4.</span>
              <div>
                <strong>Test Edge Cases:</strong> Try expired codes, already-used codes, and invalid codes to 
                see the error handling.
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}