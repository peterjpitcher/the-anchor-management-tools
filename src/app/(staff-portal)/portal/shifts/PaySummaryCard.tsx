'use client';

import { useState } from 'react';

export interface PeriodSummary {
  periodLabel: string;
  plannedHours: number;
  actualHours: number;
  plannedPay: number | null;
  actualPay: number | null;
  holidayPay: number | null;
}

interface PaySummaryCardProps {
  current: PeriodSummary;
  previous: PeriodSummary | null;
}

function fmtHours(h: number): string {
  return `${h.toFixed(1)} hrs`;
}

function fmtPay(p: number): string {
  return `£${p.toFixed(2)}`;
}

export default function PaySummaryCard({ current, previous }: PaySummaryCardProps): React.ReactElement {
  const [showPrevious, setShowPrevious] = useState(false);

  const period = showPrevious && previous ? previous : current;
  const hasPay = period.plannedPay !== null || period.actualPay !== null || period.holidayPay !== null;

  const canGoBack = !showPrevious && previous !== null;
  const canGoForward = showPrevious;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Period Navigator */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex items-center justify-between relative">
        <button
          type="button"
          onClick={() => setShowPrevious(true)}
          disabled={!canGoBack}
          className={`p-1 rounded ${canGoBack ? 'text-gray-600 hover:bg-gray-200' : 'text-gray-300 cursor-not-allowed'}`}
          aria-label="Previous period"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span className="text-sm font-medium text-gray-700">{period.periodLabel}</span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowPrevious(false)}
            disabled={!canGoForward}
            className={`p-1 rounded ${canGoForward ? 'text-gray-600 hover:bg-gray-200' : 'text-gray-300 cursor-not-allowed'}`}
            aria-label="Next period"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <a
            href="#pay-disclaimer"
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Pay disclaimer"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="5" r="0.75" fill="currentColor" />
            </svg>
          </a>
        </div>
      </div>

      {/* Summary Grid */}
      <div className="divide-y divide-gray-50">
        <div className="px-4 py-1.5 flex justify-between">
          <span className="text-sm text-gray-600">Planned Hours</span>
          <span className="text-sm font-semibold text-gray-900">{fmtHours(period.plannedHours)}</span>
        </div>

        <div className="px-4 py-1.5 flex justify-between">
          <span className="text-sm text-gray-600">Actual Hours</span>
          <span className="text-sm font-semibold text-gray-900">{fmtHours(period.actualHours)}</span>
        </div>

        {period.plannedPay !== null && (
          <div className="px-4 py-1.5 flex justify-between">
            <span className="text-sm text-gray-600">Planned Pay</span>
            <span className="text-sm font-semibold text-gray-900">{fmtPay(period.plannedPay)}</span>
          </div>
        )}

        {period.actualPay !== null && (
          <div className="px-4 py-1.5 flex justify-between">
            <span className="text-sm text-gray-600">Actual Pay</span>
            <span className="text-sm font-semibold text-gray-900">{fmtPay(period.actualPay)}</span>
          </div>
        )}

        {period.holidayPay !== null && (
          <div className="px-4 py-1.5 flex justify-between">
            <span className="text-sm text-gray-600">Holiday Pay Earned</span>
            <span className="text-sm font-semibold text-green-700">{fmtPay(period.holidayPay)}</span>
          </div>
        )}

        {!hasPay && (
          <div className="px-4 py-1.5">
            <p className="text-xs text-amber-600">Hourly rate not configured — speak to your manager</p>
          </div>
        )}
      </div>
    </div>
  );
}
