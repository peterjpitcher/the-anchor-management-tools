'use client';

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { todaysEvent } from '@/lib/mock-data/loyalty-demo';

export default function EventQRPage() {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    generateQRCode();
  }, []);

  const generateQRCode = async () => {
    setLoading(true);
    
    const url = `${window.location.origin}/checkin?event=${todaysEvent.id}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    setQrDataUrl(dataUrl);
    setLoading(false);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Generating QR codes...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Screen view */}
      <div className="print:hidden">
        <div className="max-w-4xl mx-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Event QR Code</h1>
            <p className="text-gray-600 mt-1">For tonight's event: {todaysEvent.name}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-8">
            <div className="flex flex-col items-center">
              <h2 className="text-xl font-semibold mb-4">Check-In QR Code</h2>
              <div className="bg-gray-50 p-8 rounded-lg">
                <img src={qrDataUrl} alt="Event QR Code" className="w-80 h-80" />
              </div>
              <p className="text-gray-600 mt-4 text-center max-w-md">
                Display this QR code at the venue entrance or on tables. 
                Customers scan with their phone and enter their mobile number to check in.
              </p>
              <button
                onClick={handlePrint}
                className="mt-6 bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 transition-colors font-semibold"
              >
                Print QR Code Posters
              </button>
            </div>
          </div>

          <div className="mt-6 bg-blue-50 rounded-lg p-6">
            <h3 className="font-semibold text-blue-900 mb-2">How it works:</h3>
            <ol className="space-y-2 text-blue-800">
              <li>1. Customer scans QR code with phone camera</li>
              <li>2. Opens check-in page for tonight's event</li>
              <li>3. Customer enters their mobile number</li>
              <li>4. System finds their booking and awards points</li>
              <li>5. No booking? They can still join the VIP program!</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Print view - Multiple posters per page */}
      <div className="hidden print:block">
        {/* A4 Portrait - Single large poster */}
        <div className="h-[297mm] w-[210mm] p-12 flex flex-col items-center justify-center" style={{ pageBreakAfter: 'always' }}>
          <div className="text-center">
            <h1 className="text-6xl font-bold mb-4">THE ANCHOR VIPs</h1>
            <h2 className="text-3xl mb-2">{todaysEvent.name}</h2>
            <p className="text-2xl text-gray-600 mb-12">{new Date(todaysEvent.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            
            <div className="mb-12">
              <img src={qrDataUrl} alt="Event QR" className="w-96 h-96 mx-auto" />
            </div>
            
            <div className="space-y-4 mb-12">
              <p className="text-4xl font-bold">SCAN TO CHECK IN</p>
              <p className="text-3xl">& Earn VIP Points!</p>
            </div>
            
            <div className="text-2xl space-y-2">
              <p>✓ Instant points credit</p>
              <p>✓ Track your VIP status</p>
              <p>✓ Unlock exclusive rewards</p>
            </div>
          </div>
        </div>

        {/* A4 Portrait - 2 medium posters per page */}
        <div className="h-[297mm] w-[210mm]" style={{ pageBreakAfter: 'always' }}>
          {[1, 2].map((num) => (
            <div key={num} className="h-[148.5mm] p-8 flex flex-col items-center justify-center border-b border-dashed border-gray-400">
              <div className="text-center">
                <h1 className="text-4xl font-bold mb-2">THE ANCHOR VIPs</h1>
                <h2 className="text-2xl mb-8">{todaysEvent.name}</h2>
                
                <div className="mb-8">
                  <img src={qrDataUrl} alt="Event QR" className="w-56 h-56 mx-auto" />
                </div>
                
                <div className="space-y-2">
                  <p className="text-2xl font-semibold">SCAN TO CHECK IN</p>
                  <p className="text-xl">& Earn VIP Points!</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* A4 Portrait - 4 small table tents per page */}
        <div className="grid grid-cols-2">
          {[1, 2, 3, 4].map((num) => (
            <div key={num} className="h-[148.5mm] w-[105mm] p-6 flex flex-col items-center justify-center border-r border-b border-dashed border-gray-400">
              <div className="text-center">
                <h1 className="text-2xl font-bold mb-1">THE ANCHOR VIPs</h1>
                <h2 className="text-lg mb-4">{todaysEvent.name}</h2>
                
                <div className="mb-4">
                  <img src={qrDataUrl} alt="Event QR" className="w-32 h-32 mx-auto" />
                </div>
                
                <p className="text-base font-semibold">SCAN TO CHECK IN</p>
                <p className="text-sm">& Earn VIP Points!</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 0;
          }
          body {
            margin: 0;
          }
        }
      `}</style>
    </>
  );
}