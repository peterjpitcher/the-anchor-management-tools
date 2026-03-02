'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Input } from '@/components/ui-v2/forms/Input';
import { reviewLeaveRequest } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';

interface LeaveManagerClientProps {
  initialRequests: LeaveRequest[];
  employeeMap: Record<string, string>; // employee_id -> display name
  canApprove: boolean;
  usageMap: Record<string, { count: number; allowance: number }>; // `${emp_id}:${year}` -> usage
}

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'error',
};

function daysBetween(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return Math.round(ms / 86400000) + 1;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function LeaveRequestRow({
  request,
  empName,
  canApprove,
  onUpdated,
  usage,
}: {
  request: LeaveRequest;
  empName: string;
  canApprove: boolean;
  onUpdated: (updated: LeaveRequest) => void;
  usage?: { count: number; allowance: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const [managerNote, setManagerNote] = useState('');
  const [isPending, startTransition] = useTransition();

  const days = daysBetween(request.start_date, request.end_date);

  const handleReview = (decision: 'approved' | 'declined') => {
    startTransition(async () => {
      const result = await reviewLeaveRequest(request.id, decision, managerNote || undefined);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success(decision === 'approved' ? 'Request approved' : 'Request declined');
      onUpdated({ ...request, status: decision, manager_note: managerNote || null });
      setExpanded(false);
    });
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge variant={STATUS_BADGE[request.status] ?? 'default'} size="sm">
            {request.status}
          </Badge>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{empName}</p>
            <p className="text-xs text-gray-500">
              {formatDate(request.start_date)} – {formatDate(request.end_date)} · {days} day{days !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {canApprove && request.status === 'pending' && !expanded && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleReview('approved'); }}
                disabled={isPending}
                className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                title="Approve"
              >
                <CheckIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleReview('declined'); }}
                disabled={isPending}
                className="p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                title="Decline"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </>
          )}
          {expanded ? (
            <ChevronUpIcon className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-3">
          <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Submitted</dt>
              <dd className="text-gray-900">{formatDate(request.created_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Holiday year</dt>
              <dd className="text-gray-900">{request.holiday_year}/{String(request.holiday_year + 1).slice(2)}</dd>
            </div>
            {usage && (
              <div className="col-span-2">
                <dt className="text-gray-500 text-xs mb-1">
                  Allowance used ({request.holiday_year}/{String(request.holiday_year + 1).slice(2)})
                </dt>
                <dd>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${usage.count >= usage.allowance ? 'bg-red-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(100, Math.round((usage.count / usage.allowance) * 100))}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium ${usage.count >= usage.allowance ? 'text-red-600' : 'text-gray-700'}`}>
                      {usage.count} / {usage.allowance} days
                    </span>
                  </div>
                </dd>
              </div>
            )}
            {request.note && (
              <div className="col-span-2">
                <dt className="text-gray-500 text-xs">Employee note</dt>
                <dd className="text-gray-900 italic">&ldquo;{request.note}&rdquo;</dd>
              </div>
            )}
            {request.manager_note && (
              <div className="col-span-2">
                <dt className="text-gray-500 text-xs">Manager note</dt>
                <dd className="text-gray-900">{request.manager_note}</dd>
              </div>
            )}
          </dl>

          {canApprove && request.status === 'pending' && (
            <div className="space-y-2">
              <Input
                placeholder="Manager note (optional)"
                value={managerNote}
                onChange={e => setManagerNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleReview('approved')}
                  disabled={isPending}
                >
                  {isPending ? 'Saving…' : 'Approve'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handleReview('declined')}
                  disabled={isPending}
                  className="!text-red-700 !border-red-200 hover:!bg-red-50"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeaveManagerClient({
  initialRequests,
  employeeMap,
  canApprove,
  usageMap,
}: LeaveManagerClientProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending');

  const handleUpdated = (updated: LeaveRequest) => {
    setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 border border-gray-200 rounded-lg p-1 w-fit">
        {(['pending', 'approved', 'declined', 'all'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 bg-amber-400 text-amber-900 rounded-full px-1 text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-6 text-center">
          No {filter === 'all' ? '' : filter} requests.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(req => (
            <LeaveRequestRow
              key={req.id}
              request={req}
              empName={employeeMap[req.employee_id] ?? 'Unknown employee'}
              canApprove={canApprove}
              onUpdated={handleUpdated}
              usage={usageMap[`${req.employee_id}:${req.holiday_year}`]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
