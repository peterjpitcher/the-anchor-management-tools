'use client';

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import { upsertSessionAction, submitSessionAction, getDailyTargetAction, setDailyTargetAction, getWeeklyProgressAction } from '@/app/actions/cashing-up';
import { getDailySummaryAction } from '@/app/actions/daily-summary';
import { getMissingCashupDatesAction } from '@/app/actions/missing-cashups';
import { UpsertCashupSessionDTO, CashupSession } from '@/types/cashing-up'; // Added CashupSession
import { format, parseISO } from 'date-fns';
import { WeeklyTargetsModal } from './WeeklyTargetsModal';

interface Props {
  site: { id: string; name: string };
  sessionDate: string; // New prop
  initialSessionData: CashupSession | null; // New prop
}

const DENOMINATIONS = [
  { value: 0.01, label: '1p' },
  { value: 0.02, label: '2p' },
  { value: 0.05, label: '5p' },
  { value: 0.1, label: '10p' },
  { value: 0.2, label: '20p' },
  { value: 0.5, label: '50p' },
  { value: 1, label: '£1' },
  { value: 5, label: '£5' },
  { value: 10, label: '£10' },
  { value: 20, label: '£20' },
  { value: 50, label: '£50' },
];

export function DailyCashupForm({ site, sessionDate, initialSessionData }: Props) {
  const [isPending, startTransition] = useTransition();
  
  // States derived from props or initial data
  const [sessionId, setSessionId] = useState<string | null>(initialSessionData?.id || null);
  const [date, setDate] = useState(sessionDate); // Date from prop
  
  const [siteId] = useState(site.id);
  
  const [cashExpected, setCashExpected] = useState('0');
  const [cashValues, setCashValues] = useState<Record<string, string>>({});
  const [cardTotal, setCardTotal] = useState('0');
  const [stripeTotal, setStripeTotal] = useState('0');
  const [userNotes, setUserNotes] = useState('');
  const [autoNotes, setAutoNotes] = useState('');
  
  const [dailyData, setDailyData] = useState<{
    events: any[];
    privateBookings: any[];
    tableBookings: any[];
  } | null>(null);

  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number>(0);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [newTarget, setNewTarget] = useState('');
  const [weeklyData, setWeeklyData] = useState<{ date: string; target: number; actual: number | null }[]>([]);

  // States for warning/edit flow
  const isInitialLocked = initialSessionData ? initialSessionData.status !== 'draft' : false;
  const [isFormLocked, setIsFormLocked] = useState(isInitialLocked);
  const [showWarningMessage, setShowWarningMessage] = useState(isInitialLocked);

  // Effect to initialize form with data
  useEffect(() => {
    if (initialSessionData) {
      setSessionId(initialSessionData.id);
      setDate(initialSessionData.session_date);

      // Set cash expected
      const cashExpectedBreakdown = initialSessionData.cashup_payment_breakdowns?.find(b => b.payment_type_code === 'CASH');
      setCashExpected(cashExpectedBreakdown?.expected_amount?.toString() || '0');

      // Set cash values (from cash_counts total_amount)
      const initialCashValues: Record<string, string> = {};
      initialSessionData.cashup_cash_counts?.forEach(c => {
        initialCashValues[c.denomination.toString()] = c.total_amount?.toString() || '0';
      });
      setCashValues(initialCashValues);

      // Set card and stripe totals
      const cardBreakdown = initialSessionData.cashup_payment_breakdowns?.find(b => b.payment_type_code === 'CARD');
      setCardTotal(cardBreakdown?.counted_amount?.toString() || '0');

      const stripeBreakdown = initialSessionData.cashup_payment_breakdowns?.find(b => b.payment_type_code === 'STRIPE');
      setStripeTotal(stripeBreakdown?.counted_amount?.toString() || '0');

      // Set notes
      setUserNotes(initialSessionData.notes || '');

      // Set lock status
      setIsFormLocked(initialSessionData.status !== 'draft');
      setShowWarningMessage(initialSessionData.status !== 'draft');

    } else {
      // For new entries or if no session data found for the date
      setSessionId(null);
      setDate(sessionDate); // Ensure date is set from prop for new entries
      setCashExpected('0');
      setCashValues({});
      setCardTotal('0');
      setStripeTotal('0');
      setUserNotes('');
      setIsFormLocked(false);
      setShowWarningMessage(false);
    }
  }, [initialSessionData, sessionDate]); // Re-run when initialSessionData or sessionDate changes

  // Fetch initial data (Target & Missing Dates)
  useEffect(() => {
    if (siteId) {
      getMissingCashupDatesAction(siteId).then(res => {
        if (res.success && res.dates) {
          setMissingDates(res.dates);
        }
      });
    }
  }, [siteId]);

  // Fetch daily target & weekly progress when date/site changes
  useEffect(() => {
    if (siteId && date) {
      // Target
      getDailyTargetAction(siteId, date).then(res => {
        if (res.success) {
          const target = res.data || 0;
          setDailyTarget(target);
          setNewTarget(target.toString());
        }
      });

      // Weekly Progress
      getWeeklyProgressAction(siteId, date).then(res => {
        if (res.success && res.data) {
          setWeeklyData(res.data.dailyProgress);
        }
      });
    }
  }, [siteId, date, dailyTarget]); // Added dailyTarget to dependencies

  // Calculate total cash from values
  const cashCountedTotal = useMemo(() => {
    return DENOMINATIONS.reduce((total, denom) => {
      const val = parseFloat(cashValues[denom.value] || '0');
      return total + val;
    }, 0);
  }, [cashValues]);

  // Calculate Weekly Stats (useCallback for memoization)
  const weeklyStats = useMemo(() => {
    if (!weeklyData.length) return { revenue: 0, target: 0, percent: 0 };

    let accumulatedRevenue = 0;
    let accumulatedTarget = 0;

    weeklyData.forEach(day => {
      // For today's date, use the current form's target and revenue
      if (day.date === date) {
        accumulatedRevenue += (cashCountedTotal) + (parseFloat(cardTotal) || 0) + (parseFloat(stripeTotal) || 0);
        accumulatedTarget += dailyTarget;
      } else {
        accumulatedRevenue += (day.actual || 0);
        accumulatedTarget += day.target;
      }
    });

    const percent = accumulatedTarget > 0 ? (accumulatedRevenue / accumulatedTarget) * 100 : 0;

    return {
      revenue: accumulatedRevenue,
      target: accumulatedTarget,
      percent
    };
  }, [weeklyData, cashCountedTotal, cardTotal, stripeTotal, date, dailyTarget]);

  // Fetch events for notes (useCallback for memoization)
  useEffect(() => {
    if (date) {
      setDailyData(null);
      getDailySummaryAction(date).then(res => {
        if (res.success && res.summary) {
          setAutoNotes(res.summary);
        } else {
          setAutoNotes('');
        }
        if (res.success && res.data) {
          setDailyData(res.data);
        }
      });
    }
  }, [date]);

  const variance = useMemo(() => {
    const cashVar = cashCountedTotal - (parseFloat(cashExpected) || 0);
    return cashVar; 
  }, [cashExpected, cashCountedTotal]);

  const getDTO = useCallback((): UpsertCashupSessionDTO => {
    // Reverse calculate quantities for the DB record (best effort)
    const cashCounts = DENOMINATIONS.map(denom => {
      const val = parseFloat(cashValues[denom.value] || '0');
      const quantity = Math.round(val / denom.value); // Estimate count
      return {
        denomination: denom.value,
        quantity: quantity,
      };
    }).filter(c => c.quantity > 0);

    return {
      siteId,
      sessionDate: date,
      status: initialSessionData?.status || 'draft', // Preserve existing status or default to draft
      notes: `${userNotes}\n\n--- SYSTEM GENERATED SUMMARY ---\n${autoNotes}`,
      paymentBreakdowns: [
        {
          paymentTypeCode: 'CASH', 
          paymentTypeLabel: 'Cash', 
          expectedAmount: parseFloat(cashExpected) || 0, 
          countedAmount: cashCountedTotal 
        },
        {
          paymentTypeCode: 'CARD', 
          paymentTypeLabel: 'Card', 
          expectedAmount: parseFloat(cardTotal) || 0, 
          countedAmount: parseFloat(cardTotal) || 0
        },
        {
          paymentTypeCode: 'STRIPE',
          paymentTypeLabel: 'Stripe',
          expectedAmount: parseFloat(stripeTotal) || 0,
          countedAmount: parseFloat(stripeTotal) || 0
        }
      ],
      cashCounts,
    };
  }, [siteId, date, cashValues, cashExpected, cardTotal, stripeTotal, userNotes, autoNotes, initialSessionData]);

  const handleSave = async (silent = false) => {
    if (!siteId) {
      alert('Site not found');
      return null;
    }

    const dto = getDTO();
    
    // Warn if saving a non-draft status
    if (initialSessionData && initialSessionData.status !== 'draft' && !confirm(`This session is currently '${initialSessionData.status}'. Saving will modify a processed record. Are you sure?`)) {
        return null; // User cancelled
    }

    const res = await upsertSessionAction(dto, sessionId || undefined);
    
    if (res.success && res.data) {
      setSessionId(res.data.id);
      // Refresh missing dates after save
      getMissingCashupDatesAction(siteId).then(r => r.success && setMissingDates(r.dates || []));
      
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
      const id = await handleSave(true);
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

  const handleCashValueChange = (denomValue: number, valStr: string) => {
    setCashValues(prev => ({
      ...prev,
      [denomValue]: valStr
    }));
  };

  const handleSaveTarget = async () => {
    if (!siteId || !date) return;
    const amount = parseFloat(newTarget);
    if (isNaN(amount)) {
      alert('Invalid amount');
      return;
    }
    
    // Warn if target is being set for a locked form
    if (isFormLocked && initialSessionData && initialSessionData.status !== 'draft' && !confirm(`This session is currently '${initialSessionData.status}'. Setting a new target will modify a processed record. Are you sure?`)) {
        return; // User cancelled
    }

    const res = await setDailyTargetAction(siteId, date, amount);
    if (res.success) {
      setDailyTarget(amount);
      setIsEditingTarget(false);
      refreshData(); // Refresh weekly progress too
    } else {
      alert('Failed to update target: ' + res.error);
    }
  };

  const refreshData = useCallback(() => {
    if (siteId && date) {
      getDailyTargetAction(siteId, date).then(res => {
        if (res.success) {
          const target = res.data || 0;
          setDailyTarget(target);
          setNewTarget(target.toString());
        }
      });
      getWeeklyProgressAction(siteId, date).then(res => {
        if (res.success && res.data) {
          setWeeklyData(res.data.dailyProgress);
        }
      });
    }
  }, [siteId, date]);

  // Handle date change from Date picker
  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    // Redirect to the same page with the new date as a search param
    window.location.href = `/cashing-up/daily?date=${newDate}&siteId=${siteId}`;
  };

  return (
    <>
      {showTargetModal && (
        <WeeklyTargetsModal 
          siteId={siteId} 
          onClose={() => setShowTargetModal(false)} 
          onSave={refreshData} 
        />
      )}
      <style dangerouslySetInnerHTML={{__html: `
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}} />
      
      <div className="space-y-6 bg-white p-6 rounded-lg shadow border w-full mx-auto">

        {showWarningMessage && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded mb-4 flex justify-between items-center">
                <div>
                    <p className="font-bold text-sm">Warning: This is an {initialSessionData?.status || 'approved'} session.</p>
                    <p className="text-xs">Editing this record may affect historical data. Proceed with caution.</p>
                </div>
                <button 
                    onClick={() => { setIsFormLocked(false); setShowWarningMessage(false); }}
                    className="bg-yellow-200 hover:bg-yellow-300 text-yellow-900 text-sm px-4 py-2 rounded font-medium"
                >
                    Edit Anyway
                </button>
            </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div>
            <label className="block text-sm font-medium mb-1">Site</label>
            <div className="p-2 bg-gray-100 rounded border text-gray-600">
              {site.name}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <div className="flex items-center gap-4">
              <input 
                type="date" 
                value={date} 
                onChange={onDateChange} // Changed to onDateChange for page navigation
                className="flex-1 border rounded p-2"
                disabled={isFormLocked} // Disabled if locked
              />
              <div className="text-sm bg-blue-50 text-blue-800 px-3 py-2 rounded border border-blue-200 flex items-center gap-2 min-w-[200px]">
                <span className="font-semibold">Target:</span> 
                {isEditingTarget ? (
                  <div className="flex items-center gap-1">
                    <input 
                      type="number" 
                      value={newTarget}
                      onChange={e => setNewTarget(e.target.value)}
                      className="w-20 p-1 text-sm border rounded"
                      disabled={isFormLocked} // Disabled if locked
                    />
                    <button onClick={handleSaveTarget} className="text-green-600 hover:text-green-800" disabled={isFormLocked}>✓</button>
                    <button onClick={() => setIsEditingTarget(false)} className="text-red-600 hover:text-red-800" disabled={isFormLocked}>✕</button>
                  </div>
                ) : (
                  <>
                    <span>£{dailyTarget}</span>
                    <button 
                      onClick={() => setIsEditingTarget(true)}
                      className="text-xs text-blue-600 hover:underline ml-1"
                      disabled={isFormLocked} // Disabled if locked
                    >
                      Edit
                    </button>
                    <span className="text-gray-300 mx-1">|</span>
                    <button 
                      onClick={() => setShowTargetModal(true)}
                      className="text-xs text-blue-600 hover:underline"
                      disabled={isFormLocked} // Disabled if locked
                    >
                      Set Defaults
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* WEEKLY PROGRESS */}
        <div className="border-t pt-4">
          <div className="bg-blue-50 p-4 rounded border border-blue-100 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h4 className="text-sm font-bold text-blue-900 uppercase">Weekly Progress</h4>
              <p className="text-xs text-blue-700">Accumulated (Mon - Today)</p>
            </div>
            <div className="flex-1 w-full md:w-auto px-4">
              <div className="flex justify-between text-sm font-medium mb-1">
                <span>£{weeklyStats.revenue.toFixed(2)}</span>
                <span className="text-gray-500">of £{weeklyStats.target.toFixed(2)}</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2.5">
                <div 
                  className={`h-2.5 rounded-full ${weeklyStats.percent >= 100 ? 'bg-green-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.min(weeklyStats.percent, 100)}%` }}
                ></div>
              </div>
            </div>
            <div className="text-right">
              <span className={`text-2xl font-bold ${weeklyStats.percent >= 100 ? 'text-green-600' : 'text-blue-800'}`}>
                {weeklyStats.percent.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* CASH SECTION - Column 1 */}
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded border h-full">
                <h4 className="font-bold text-gray-700 uppercase mb-3">Cash</h4>
                
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Cash Drawer Count (Total Value)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {DENOMINATIONS.map(denom => (
                      <div key={denom.value} className="flex items-center justify-between bg-white p-1 rounded border">
                        <span className="text-xs font-medium w-8 text-center text-gray-600">{denom.label}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 text-xs">£</span>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={cashValues[denom.value] || ''}
                            onChange={e => handleCashValueChange(denom.value, e.target.value)}
                            className="w-20 p-1 text-right text-sm border-none focus:ring-0"
                            disabled={isFormLocked} // Disabled if locked
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center py-2 border-t border-gray-200">
                  <span className="text-sm font-bold text-gray-700">Total Counted:</span>
                  <span className="font-mono font-bold text-lg">
                    £{cashCountedTotal.toFixed(2)}
                  </span>
                </div>

                {/* MOVED Expected (Z-Read) below counts */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-200 mt-2">
                  <span className="text-sm text-gray-500 font-medium">Expected (Z-Read):</span>
                  <div className="relative">
                    <span className="absolute left-2 top-2 text-gray-400">£</span>
                    <input 
                      type="number" step="0.01"
                      value={cashExpected} 
                      onChange={e => setCashExpected(e.target.value)}
                      className="border rounded p-2 pl-6 w-32 text-right font-medium"
                      disabled={isFormLocked} // Disabled if locked
                    />
                  </div>
                </div>
                
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-medium text-gray-600">Variance:</span>
                  <span className={`font-mono font-bold ${(cashCountedTotal - (parseFloat(cashExpected)||0)) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    £{(cashCountedTotal - (parseFloat(cashExpected)||0)).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            
            {/* CARD & STRIPE SECTION - Column 2 */}
            <div className="space-y-4">
               {/* CARD */}
               <div className="bg-gray-50 p-4 rounded border">
                <h4 className="font-bold text-gray-700 uppercase mb-3">Card</h4>
                
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-gray-500 font-medium">Card Total (Terminal):</span>
                  <div className="relative">
                    <span className="absolute left-2 top-2 text-gray-400">£</span>
                    <input 
                      type="number" step="0.01"
                      value={cardTotal} 
                      onChange={e => setCardTotal(e.target.value)}
                      className="border rounded p-2 pl-6 w-32 text-right font-medium"
                      disabled={isFormLocked} // Disabled if locked
                    />
                  </div>
                </div>
              </div>

              {/* STRIPE */}
              <div className="bg-gray-50 p-4 rounded border">
                <h4 className="font-bold text-gray-700 uppercase mb-3">Stripe</h4>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 font-medium">Total (Dashboard):</span>
                  <div className="relative">
                    <span className="absolute left-2 top-2 text-gray-400">£</span>
                    <input 
                      type="number" step="0.01"
                      value={stripeTotal} 
                      onChange={e => setStripeTotal(e.target.value)}
                      className="border rounded p-2 pl-6 w-32 text-right font-medium"
                      disabled={isFormLocked} // Disabled if locked
                    />
                  </div>
                </div>
              </div>

              {/* SUMMARY & NOTES */}
              <div className="bg-blue-50 p-4 rounded border border-blue-100 flex justify-between items-center">
                <span className="text-lg font-bold text-blue-900">Total Variance</span>
                <span className={`text-xl font-bold font-mono ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-green-600' : 'text-gray-800'}`}>
                  £{variance.toFixed(2)}
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes / Variance Reason</label>
                <textarea 
                  value={userNotes} 
                  onChange={e => setUserNotes(e.target.value)}
                  className="w-full border rounded p-2 h-24 mb-2"
                  placeholder="Enter your notes here..."
                  disabled={isFormLocked} // Disabled if locked
                />
                 {autoNotes && (
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200 text-xs text-gray-700 whitespace-pre-wrap">
                    <strong>Auto-detected events:</strong><br/>
                    {autoNotes}
                  </div>
                )}
              </div>
            </div>

            {/* DAILY ACTIVITY - Column 3 */}
            <div className="space-y-4">
              
              {/* MISSING DATES SECTION */}
              {missingDates.length > 0 && (
                <div className="bg-red-50 p-4 rounded border border-red-200">
                  <h4 className="font-bold text-red-800 text-sm mb-2 uppercase flex items-center gap-2">
                    ⚠️ Missing Cashing Up
                  </h4>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {missingDates.map(d => (
                      <li key={d} className="flex justify-between items-center text-sm">
                        <span className="text-red-700 font-medium">
                          {format(parseISO(d), 'EEE dd MMM')}
                        </span>
                        <button 
                          onClick={() => setDate(d)}
                          className="text-xs bg-white border border-red-200 px-2 py-0.5 rounded text-red-600 hover:bg-red-50"
                          disabled={isFormLocked} // Disabled if locked
                        >
                          Go
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {dailyData ? (
                 <div className="space-y-4">
                    {/* Events */}
                    <div className="bg-purple-50 p-4 rounded border border-purple-100">
                      <h4 className="font-bold text-purple-800 text-sm mb-3 uppercase">Events ({dailyData.events.length})</h4>
                      {dailyData.events.length === 0 ? (
                        <p className="text-gray-500 text-sm italic">No events scheduled</p>
                      ) : (
                        <ul className="space-y-2">
                          {dailyData.events.map((e: any) => (
                            <li key={e.id} className="text-sm border-b border-purple-200 last:border-0 pb-1 last:pb-0">
                              <div className="font-medium text-purple-900">{e.name}</div>
                              <div className="text-xs text-purple-700">{e.time} • {e.booked_count || 0} booked</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Private Bookings */}
                    <div className="bg-amber-50 p-4 rounded border border-amber-100">
                      <h4 className="font-bold text-amber-800 text-sm mb-3 uppercase">Private Bookings ({dailyData.privateBookings.length})</h4>
                      {dailyData.privateBookings.length === 0 ? (
                        <p className="text-gray-500 text-sm italic">No private bookings</p>
                      ) : (
                        <ul className="space-y-2">
                          {dailyData.privateBookings.map((pb: any) => (
                            <li key={pb.id} className="text-sm border-b border-amber-200 last:border-0 pb-1 last:pb-0">
                              <div className="font-medium text-amber-900">{pb.customer_name || 'Unknown Customer'}</div>
                              <div className="text-xs text-amber-700">{pb.event_type || 'Private Event'} • {pb.guest_count || 0} guests</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Table Bookings */}
                    <div className="bg-emerald-50 p-4 rounded border border-emerald-100">
                      <h4 className="font-bold text-emerald-800 text-sm mb-3 uppercase">Table Bookings ({dailyData.tableBookings.length})</h4>
                      {dailyData.tableBookings.length === 0 ? (
                        <p className="text-gray-500 text-sm italic">No table bookings</p>
                      ) : (
                        <div className="max-h-96 overflow-y-auto">
                          <ul className="space-y-2">
                            {dailyData.tableBookings.map((tb: any) => (
                              <li key={tb.id} className="text-sm border-b border-emerald-200 last:border-0 pb-1 last:pb-0">
                                <div className="font-medium text-emerald-900">
                                  {tb.customer?.first_name} {tb.customer?.last_name}
                                </div>
                                <div className="text-xs text-emerald-700">
                                  {tb.booking_time} • {tb.party_size}ppl
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                 </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded border text-center text-gray-500 italic">
                  Select a date to load activity...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
           <button 
            onClick={onSaveClick}
            disabled={isPending || isFormLocked}
            className="bg-gray-100 text-gray-800 px-6 py-2 rounded hover:bg-gray-200 disabled:opacity-50 font-medium"
          >
            {isPending ? 'Saving...' : 'Save Draft'}
          </button>
          <button 
            onClick={onSubmitClick}
            disabled={isPending || isFormLocked}
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            Submit
          </button>
        </div>
      </div>
    </>
  );
}