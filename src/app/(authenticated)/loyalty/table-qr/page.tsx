'use client';

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { todaysEvent } from '@/lib/mock-data/loyalty-demo';

interface TableQR {
  tableNumber: number;
  qrDataUrl: string;
}

export default function TableQRPage() {
  const [tableQRs, setTableQRs] = useState<TableQR[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTables, setSelectedTables] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8]);

  useEffect(() => {
    generateQRCodes();
  }, [selectedTables]);

  const generateQRCodes = async () => {
    setLoading(true);
    const qrs: TableQR[] = [];
    
    for (const tableNum of selectedTables) {
      const url = `${window.location.origin}/checkin?event=${todaysEvent.id}&table=${tableNum}`;
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      qrs.push({
        tableNumber: tableNum,
        qrDataUrl
      });
    }
    
    setTableQRs(qrs);
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
        <div className="max-w-7xl mx-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Table QR Codes</h1>
            <p className="text-gray-600 mt-1">For tonight's event: {todaysEvent.name}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Select Tables</h2>
              <button
                onClick={handlePrint}
                className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors"
              >
                Print Cards
              </button>
            </div>
            
            <div className="grid grid-cols-8 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(num => (
                <label key={num} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedTables.includes(num)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTables([...selectedTables, num].sort((a, b) => a - b));
                      } else {
                        setSelectedTables(selectedTables.filter(t => t !== num));
                      }
                    }}
                    className="mr-2"
                  />
                  <span>Table {num}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {tableQRs.map(({ tableNumber, qrDataUrl }) => (
              <div key={tableNumber} className="bg-white rounded-lg shadow p-4">
                <h3 className="text-center font-semibold mb-2">Table {tableNumber}</h3>
                <img src={qrDataUrl} alt={`Table ${tableNumber} QR`} className="w-full" />
                <p className="text-xs text-gray-500 text-center mt-2">
                  Scan to check in & earn points
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Print view - A4 format with 4 cards per page */}
      <div className="hidden print:block">
        <div className="grid grid-cols-2 gap-0">
          {tableQRs.map(({ tableNumber, qrDataUrl }) => (
            <div 
              key={tableNumber} 
              className="h-[148.5mm] w-[105mm] p-8 flex flex-col items-center justify-center border-r border-b border-dashed border-gray-400"
              style={{ pageBreakInside: 'avoid' }}
            >
              <div className="text-center">
                <h1 className="text-3xl font-bold mb-2">THE ANCHOR</h1>
                <h2 className="text-xl mb-6">Table {tableNumber}</h2>
                
                <div className="mb-6">
                  <img src={qrDataUrl} alt={`Table ${tableNumber} QR`} className="w-48 h-48 mx-auto" />
                </div>
                
                <div className="space-y-2">
                  <p className="text-lg font-semibold">SCAN TO CHECK IN</p>
                  <p className="text-base">& Earn VIP Points!</p>
                </div>
                
                <div className="mt-6 text-sm space-y-1">
                  <p>• Instant points credit</p>
                  <p>• See your VIP status</p>
                  <p>• Exclusive rewards</p>
                </div>
                
                <div className="mt-6 text-xs text-gray-600">
                  <p>Need help? Ask our staff</p>
                </div>
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