'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, ModalActions, ConfirmDialog, Select } from '@/ds';
import { clockIn, clockOut } from '@/app/actions/timeclock';
import type { OpenSessionSummary } from '@/app/actions/timeclock';
import { displayName } from '@/lib/employees/display-name';

type OpenSession = OpenSessionSummary & { employee_name: string };

interface Employee {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
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

// The clock band is a staff-facing screen, so people are named the way the team
// calls them. The helper still falls back to the legal name, so nobody renders
// blank when no preferred name is set.
function empName(e: Employee): string {
  return displayName(e);
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
      {/* Clocked-in employee badges. They sit on the kiosk's dark green header, outside the
          screen's data-touch-targets wrapper, so they set the 44px floor themselves (D6). */}
      {sessions.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => setConfirmSession(s)}
          className="inline-flex min-h-touch items-center gap-1.5 rounded-pill border border-on-dark-subtle bg-on-dark-hover px-3 py-1 text-xs font-medium text-on-dark transition hover:bg-on-dark-active focus-visible:outline-hidden focus-visible:shadow-ring"
          title={`Clocked in at ${formatClockInTime(s.clock_in_at)} — click to clock out`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-brand-300" />
          {s.employee_name} · {formatClockInTime(s.clock_in_at)}
        </button>
      ))}

      {/* Clock In button */}
      <button
        type="button"
        onClick={() => { setSelectedId(''); setShowClockInModal(true); }}
        className="inline-flex min-h-touch items-center gap-1.5 rounded-md border border-on-dark-subtle bg-on-dark-hover px-3 py-1.5 text-xs font-semibold text-on-dark shadow-sm transition hover:bg-on-dark-active focus-visible:outline-hidden focus-visible:shadow-ring"
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
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setShowClockInModal(false)}
              className="min-h-touch"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleClockIn}
              disabled={clockInPending || !selectedId}
              className="min-h-touch"
            >
              {clockInPending ? 'Clocking in…' : 'Clock In'}
            </Button>
          </ModalActions>
        }
      >
        <div className="space-y-4">
          {availableEmployees.length === 0 ? (
            <p className="text-sm text-text-muted">All staff are already clocked in.</p>
          ) : (
            <Select
              id="foh-clock-in-employee"
              label="Who's clocking in?"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="min-h-touch"
              autoFocus
            >
              <option value="">Select employee…</option>
              {availableEmployees.map(e => (
                <option key={e.employee_id} value={e.employee_id}>{empName(e)}</option>
              ))}
            </Select>
          )}
        </div>
      </Modal>

      {/* Clock Out confirmation */}
      <ConfirmDialog
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
