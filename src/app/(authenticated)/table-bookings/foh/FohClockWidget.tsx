'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { Modal, ModalActions, ConfirmModal } from '@/components/ui-v2/overlay/Modal';
import { clockIn, clockOut } from '@/app/actions/timeclock';
import type { TimeclockSession } from '@/app/actions/timeclock';

type OpenSession = TimeclockSession & { employee_name: string };

interface Employee {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
}

interface FohClockWidgetProps {
  employees: Employee[];
  initialSessions: OpenSession[];
}

function formatClockInTime(clockInAt: string): string {
  return new Date(clockInAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

function empName(e: Employee): string {
  return [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown';
}

export default function FohClockWidget({ employees, initialSessions }: FohClockWidgetProps) {
  const [sessions, setSessions] = useState<OpenSession[]>(initialSessions);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [confirmSession, setConfirmSession] = useState<OpenSession | null>(null);
  const [clockInPending, startClockInTransition] = useTransition();
  const [clockOutPending, startClockOutTransition] = useTransition();

  const clockedInIds = new Set(sessions.map(s => s.employee_id));
  const availableEmployees = employees.filter(e => !clockedInIds.has(e.employee_id));

  const handleClockIn = () => {
    if (!selectedId) { toast.error('Select an employee'); return; }
    startClockInTransition(async () => {
      const emp = employees.find(e => e.employee_id === selectedId)!;
      const result = await clockIn(selectedId);
      if (!result.success) { toast.error(result.error); return; }
      setSessions(prev => [...prev, { ...result.data, employee_name: empName(emp) }]);
      toast.success(`${empName(emp)} clocked in`);
      setSelectedId('');
      setShowClockInModal(false);
    });
  };

  const handleClockOut = () => {
    if (!confirmSession) return;
    const session = confirmSession;
    startClockOutTransition(async () => {
      const result = await clockOut(session.employee_id);
      if (!result.success) { toast.error(result.error); return; }
      setSessions(prev => prev.filter(s => s.id !== session.id));
      toast.success(`${session.employee_name} clocked out`);
      setConfirmSession(null);
    });
  };

  return (
    <>
      {/* Clocked-in employee badges */}
      {sessions.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => setConfirmSession(s)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs font-medium !text-white transition hover:bg-white/30 hover:!bg-white/30"
          title={`Clocked in at ${formatClockInTime(s.clock_in_at)} — click to clock out`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-green-300" />
          {s.employee_name} · {formatClockInTime(s.clock_in_at)}
        </button>
      ))}

      {/* Clock In button */}
      <button
        type="button"
        onClick={() => { setSelectedId(''); setShowClockInModal(true); }}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/40 bg-white/15 px-3 py-1.5 text-xs font-semibold !text-white shadow-sm transition hover:bg-white/25 hover:!bg-white/25"
      >
        Clock In
      </button>

      {/* Clock In modal */}
      <Modal
        open={showClockInModal}
        onClose={() => setShowClockInModal(false)}
        title="Clock In"
        size="sm"
        footer={
          <ModalActions>
            <button
              type="button"
              onClick={() => setShowClockInModal(false)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClockIn}
              disabled={clockInPending || !selectedId}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {clockInPending ? 'Clocking in…' : 'Clock In'}
            </button>
          </ModalActions>
        }
      >
        <div className="space-y-4">
          {availableEmployees.length === 0 ? (
            <p className="text-sm text-gray-500">All staff are already clocked in.</p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Who&apos;s clocking in?
              </label>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                autoFocus
              >
                <option value="">Select employee…</option>
                {availableEmployees.map(e => (
                  <option key={e.employee_id} value={e.employee_id}>{empName(e)}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Clock Out confirmation */}
      <ConfirmModal
        open={!!confirmSession}
        onClose={() => setConfirmSession(null)}
        onConfirm={handleClockOut}
        title="Clock Out"
        message={
          confirmSession
            ? `Ready to clock out, ${confirmSession.employee_name}? You clocked in at ${formatClockInTime(confirmSession.clock_in_at)}.`
            : ''
        }
        confirmLabel={clockOutPending ? 'Clocking out…' : 'Yes, clock out'}
        cancelLabel="Not yet"
        variant="primary"
      />
    </>
  );
}
