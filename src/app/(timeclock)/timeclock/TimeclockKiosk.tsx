'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { clockIn, clockOut } from '@/app/actions/timeclock';
import type { TimeclockSession } from '@/app/actions/timeclock';

interface Employee {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
}

interface TimeclockKioskProps {
  employees: Employee[];
  openSessions: (TimeclockSession & { employee_name: string })[];
}

function empName(e: Employee): string {
  return [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Staff';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function TimeclockKiosk({ employees, openSessions: initialSessions }: TimeclockKioskProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedId, setSelectedId] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectedEmp = employees.find(e => e.employee_id === selectedId);
  const isAlreadyClockedIn = sessions.some(s => s.employee_id === selectedId);

  const handleClockIn = () => {
    if (!selectedId) { toast.error('Please select your name'); return; }
    if (isAlreadyClockedIn) { toast.error('You are already clocked in'); return; }
    startTransition(async () => {
      const result = await clockIn(selectedId);
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`Welcome in, ${empName(selectedEmp!)} 👋`);
      setSessions(prev => [...prev, { ...result.data, employee_name: empName(selectedEmp!) }]);
      setSelectedId('');
      router.refresh();
    });
  };

  const handleClockOut = () => {
    if (!selectedId) { toast.error('Please select your name'); return; }
    if (!isAlreadyClockedIn) { toast.error('You are not currently clocked in'); return; }
    startTransition(async () => {
      const result = await clockOut(selectedId);
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`See you later, ${empName(selectedEmp!)}! ✅`);
      setSessions(prev => prev.filter(s => s.employee_id !== selectedId));
      setSelectedId('');
      router.refresh();
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 py-8">
      {/* Header */}
      <div className="text-center mb-10">
        <p className="text-4xl font-bold text-white tracking-tight mb-1">{currentTime}</p>
        <p className="text-gray-400 text-lg">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Main card */}
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-white">Staff Timeclock</h1>
          <p className="text-sm text-gray-400 mt-0.5">Select your name to clock in or out</p>
        </div>

        {/* Employee selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Your name
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            disabled={isPending}
          >
            <option value="">— Select name —</option>
            {employees.map(e => (
              <option key={e.employee_id} value={e.employee_id}>
                {empName(e)}
                {sessions.some(s => s.employee_id === e.employee_id) ? ' ✓ clocked in' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Status indicator */}
        {selectedId && (
          <div className={`rounded-xl px-4 py-3 text-sm ${isAlreadyClockedIn ? 'bg-green-900/40 border border-green-700/50 text-green-300' : 'bg-gray-800 border border-gray-700 text-gray-300'}`}>
            {isAlreadyClockedIn ? (
              <>
                <span className="font-medium text-green-200">{selectedEmp ? empName(selectedEmp) : ''}</span>
                {' '}is currently clocked in since{' '}
                {formatTime(sessions.find(s => s.employee_id === selectedId)?.clock_in_at ?? '')}
              </>
            ) : (
              <>
                <span className="font-medium text-white">{selectedEmp ? empName(selectedEmp) : ''}</span>
                {' '}is not clocked in
              </>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleClockIn}
            disabled={isPending || !selectedId || isAlreadyClockedIn}
            className="py-4 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-base transition-colors"
          >
            {isPending ? '…' : 'Clock In'}
          </button>
          <button
            type="button"
            onClick={handleClockOut}
            disabled={isPending || !selectedId || !isAlreadyClockedIn}
            className="py-4 px-4 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-base transition-colors"
          >
            {isPending ? '…' : 'Clock Out'}
          </button>
        </div>
      </div>

      {/* Currently clocked in */}
      {sessions.length > 0 && (
        <div className="mt-8 w-full max-w-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3 text-center">
            Currently on shift
          </p>
          <div className="space-y-2">
            {sessions.map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-gray-900/60 rounded-xl border border-gray-800 px-4 py-2.5"
              >
                <p className="text-sm text-white font-medium">{s.employee_name}</p>
                <p className="text-xs text-gray-400">since {formatTime(s.clock_in_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
