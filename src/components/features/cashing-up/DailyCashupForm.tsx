'use client';

import { useState, useTransition, useMemo } from 'react';
import { upsertSessionAction, submitSessionAction } from '@/app/actions/cashing-up';
import { UpsertCashupSessionDTO } from '@/types/cashing-up';

interface Props {
  sites: { id: string; name: string }[];
}

export function DailyCashupForm({ sites }: Props) {
  const [isPending, startTransition] = useTransition();
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const [siteId, setSiteId] = useState(sites[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [shift, setShift] = useState('DAY');
  
  const [cashExpected, setCashExpected] = useState('0');
  const [cashCounted, setCashCounted] = useState('0');
  
  const [cardExpected, setCardExpected] = useState('0');
  const [cardCounted, setCardCounted] = useState('0');
  
  const [notes, setNotes] = useState('');

  const variance = useMemo(() => {
    const cashVar = (parseFloat(cashCounted) || 0) - (parseFloat(cashExpected) || 0);
    const cardVar = (parseFloat(cardCounted) || 0) - (parseFloat(cardExpected) || 0);
    return cashVar + cardVar;
  }, [cashExpected, cashCounted, cardExpected, cardCounted]);

  const getDTO = (): UpsertCashupSessionDTO => ({
    siteId,
    sessionDate: date,
    shiftCode: shift,
    status: 'draft',
    notes,
    paymentBreakdowns: [
      { 
        paymentTypeCode: 'CASH', 
        paymentTypeLabel: 'Cash', 
        expectedAmount: parseFloat(cashExpected) || 0, 
        countedAmount: parseFloat(cashCounted) || 0 
      },
      { 
        paymentTypeCode: 'CARD', 
        paymentTypeLabel: 'Card', 
        expectedAmount: parseFloat(cardExpected) || 0, 
        countedAmount: parseFloat(cardCounted) || 0 
      },
    ],
    cashCounts: [],
  });

  const handleSave = async (silent = false) => {
    if (!siteId) {
      alert('Please select a site');
      return null;
    }

    const dto = getDTO();
    const res = await upsertSessionAction(dto, sessionId || undefined);
    
    if (res.success && res.data) {
      setSessionId(res.data.id);
      if (!silent) alert('Saved successfully!');
      return res.data.id;
    } else {
      alert('Error: ' + (res.error || 'Unknown error'));
      return null;
    }
  };

  const onSaveClick = () => {
    startTransition(async () => {
      await handleSave();
    });
  };

  const onSubmitClick = () => {
    if (!confirm('Are you sure you want to submit? This will lock the session for approval.')) return;
    
    startTransition(async () => {
      const id = await handleSave(true); // save silently first
      if (id) {
        const res = await submitSessionAction(id);
        if (res.success) {
          alert('Submitted successfully!');
        } else {
          alert('Error submitting: ' + res.error);
        }
      }
    });
  };

  return (
    <div className="space-y-6 bg-white p-6 rounded-lg shadow border">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Site</label>
          <select 
            value={siteId} 
            onChange={e => setSiteId(e.target.value)}
            className="w-full border rounded p-2"
            disabled={!!sessionId}
          >
            {sites.map(site => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={e => setDate(e.target.value)}
            className="w-full border rounded p-2"
            disabled={!!sessionId}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Shift</label>
          <select 
            value={shift} 
            onChange={e => setShift(e.target.value)}
            className="w-full border rounded p-2"
            disabled={!!sessionId}
          >
            <option value="DAY">Day</option>
            <option value="EVE">Eve</option>
            <option value="NIGHT">Night</option>
          </select>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-semibold mb-4 text-lg">Payment Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CASH */}
          <div className="bg-gray-50 p-4 rounded space-y-3">
            <label className="block text-sm font-bold text-gray-700 uppercase">Cash</label>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Expected (Z-Read):</span>
              <div className="relative">
                <span className="absolute left-2 top-2 text-gray-400">£</span>
                <input 
                  type="number" step="0.01"
                  value={cashExpected} 
                  onChange={e => setCashExpected(e.target.value)}
                  className="border rounded p-2 pl-6 w-32 text-right"
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Counted:</span>
              <div className="relative">
                <span className="absolute left-2 top-2 text-gray-400">£</span>
                <input 
                  type="number" step="0.01"
                  value={cashCounted} 
                  onChange={e => setCashCounted(e.target.value)}
                  className="border rounded p-2 pl-6 w-32 text-right"
                />
              </div>
            </div>
            
            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-sm font-medium text-gray-600">Variance:</span>
              <span className={`font-mono font-bold ${
                ((parseFloat(cashCounted)||0) - (parseFloat(cashExpected)||0)) < 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                £{((parseFloat(cashCounted)||0) - (parseFloat(cashExpected)||0)).toFixed(2)}
              </span>
            </div>
          </div>
          
          {/* CARD */}
          <div className="bg-gray-50 p-4 rounded space-y-3">
            <label className="block text-sm font-bold text-gray-700 uppercase">Card</label>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Expected (Z-Read):</span>
              <div className="relative">
                <span className="absolute left-2 top-2 text-gray-400">£</span>
                <input 
                  type="number" step="0.01"
                  value={cardExpected} 
                  onChange={e => setCardExpected(e.target.value)}
                  className="border rounded p-2 pl-6 w-32 text-right"
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Counted:</span>
              <div className="relative">
                <span className="absolute left-2 top-2 text-gray-400">£</span>
                <input 
                  type="number" step="0.01"
                  value={cardCounted} 
                  onChange={e => setCardCounted(e.target.value)}
                  className="border rounded p-2 pl-6 w-32 text-right"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-sm font-medium text-gray-600">Variance:</span>
              <span className={`font-mono font-bold ${
                ((parseFloat(cardCounted)||0) - (parseFloat(cardExpected)||0)) < 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                £{((parseFloat(cardCounted)||0) - (parseFloat(cardExpected)||0)).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-blue-50 p-4 rounded flex justify-between items-center">
          <span className="text-lg font-bold text-blue-900">Total Variance</span>
          <span className={`text-xl font-bold font-mono ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-green-600' : 'text-gray-800'}`}>
            £{variance.toFixed(2)}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notes / Variance Reason</label>
        <textarea 
          value={notes} 
          onChange={e => setNotes(e.target.value)}
          className="w-full border rounded p-2 h-24"
          placeholder="Explain any discrepancies..."
        />
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
         <button 
          onClick={onSaveClick}
          disabled={isPending}
          className="bg-gray-100 text-gray-800 px-6 py-2 rounded hover:bg-gray-200 disabled:opacity-50 font-medium"
        >
          {isPending ? 'Saving...' : 'Save Draft'}
        </button>
        <button 
          onClick={onSubmitClick}
          disabled={isPending}
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
