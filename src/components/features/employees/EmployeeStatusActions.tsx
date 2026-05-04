'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { beginSeparation, revokeEmployeeAccess, resendInvite } from '@/app/actions/employeeInvite';
import { toast } from '@/components/ui-v2/feedback/Toast';

interface EmployeeStatusActionsProps {
  employeeId: string;
  status: string;
  canEdit: boolean;
}

function todayInputValue(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export default function EmployeeStatusActions({ employeeId, status, canEdit }: EmployeeStatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState<'separation' | 'revoke' | null>(null);
  const [separationEndDate, setSeparationEndDate] = useState(todayInputValue);
  const [separationNote, setSeparationNote] = useState('');

  if (!canEdit) return null;

  const handleResendInvite = async () => {
    setLoading(true);
    try {
      const result = await resendInvite(employeeId);
      if (result.type === 'success') {
        toast.success(result.message || 'Invite resent.');
      } else {
        toast.error(result.message || 'Failed to resend invite.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBeginSeparation = async () => {
    setShowConfirm(null);
    setLoading(true);
    try {
      const result = await beginSeparation(employeeId, {
        employmentEndDate: separationEndDate,
        note: separationNote.trim() || undefined,
      });
      if (result.success) {
        toast.success('Employee status updated to Started Separation.');
        setSeparationNote('');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to update status.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAccess = async () => {
    setShowConfirm(null);
    setLoading(true);
    try {
      const result = await revokeEmployeeAccess(employeeId);
      if (result.success) {
        toast.success('Employee access revoked and status set to Former.');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to revoke access.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {status === 'Onboarding' && (
        <button
          type="button"
          onClick={handleResendInvite}
          disabled={loading}
          className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-blue-600 ring-1 ring-inset ring-blue-300 bg-white hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Resend Invite'}
        </button>
      )}

      {status === 'Active' && (
        <button
          type="button"
          onClick={() => setShowConfirm('separation')}
          disabled={loading}
          className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-yellow-700 ring-1 ring-inset ring-yellow-300 bg-white hover:bg-yellow-50 transition-colors disabled:opacity-50"
        >
          Begin Separation
        </button>
      )}

      {status === 'Started Separation' && (
        <button
          type="button"
          onClick={() => setShowConfirm('revoke')}
          disabled={loading}
          className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-300 bg-white hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Mark as Former'}
        </button>
      )}

      {/* Confirmation modals */}
      {showConfirm === 'separation' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowConfirm(null)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Begin Separation</h3>
              <p className="text-sm text-gray-600 mb-6">
                This will change the employee status to &quot;Started Separation&quot;. Their system access will not be affected yet.
              </p>
              <div className="space-y-4 mb-6">
                <div>
                  <label htmlFor="separation-end-date" className="block text-sm font-medium text-gray-700">
                    Last working day
                  </label>
                  <input
                    id="separation-end-date"
                    type="date"
                    value={separationEndDate}
                    onChange={(event) => setSeparationEndDate(event.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="separation-note" className="block text-sm font-medium text-gray-700">
                    Note
                  </label>
                  <textarea
                    id="separation-note"
                    value={separationNote}
                    onChange={(event) => setSeparationNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                    placeholder="Optional reason or handover note"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowConfirm(null)} className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" onClick={handleBeginSeparation} disabled={!separationEndDate} className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-500 disabled:opacity-50">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirm === 'revoke' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowConfirm(null)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Mark as Former & Revoke Access</h3>
              <p className="text-sm text-gray-600 mb-6">
                This will set the employee status to &quot;Former&quot;, set their employment end date to today, and remove all their system permissions. This cannot be undone automatically. Continue?
              </p>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowConfirm(null)} className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" onClick={handleRevokeAccess} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
