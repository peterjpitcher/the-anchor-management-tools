export interface PeriodSummary {
  periodLabel: string;
  plannedHours: number;
  actualHours: number;
  plannedPay: number | null;
  actualPay: number | null;
  holidayPay: number | null;
  /**
   * Premium UPLIFT already included in the pay figures above (null when none):
   * premiumHours × (effectiveRate − baseRate), i.e. the extra ABOVE base.
   * This is NOT payroll's PayrollRow.premiumPay (the full premium-portion pay) —
   * do not treat the two identically-shaped fields as interchangeable.
   */
  premiumUpliftPay: number | null;
}

interface PaySummaryCardProps {
  current: PeriodSummary;
}

function fmtHours(h: number): string {
  return `${h.toFixed(1)} hrs`;
}

function fmtPay(p: number): string {
  return `£${p.toFixed(2)}`;
}

export default function PaySummaryCard({ current }: PaySummaryCardProps): React.ReactElement {
  const period = current;
  const hasPay = period.plannedPay !== null || period.actualPay !== null || period.holidayPay !== null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Period Navigator */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{period.periodLabel}</span>
        <a href="#pay-disclaimer" className="p-1 text-gray-400 hover:text-gray-600" title="Pay disclaimer">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="5" r="0.75" fill="currentColor" />
          </svg>
        </a>
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

        {period.premiumUpliftPay !== null && (
          <div className="px-4 py-1.5 flex justify-between">
            <span className="text-sm text-gray-600">incl. premium uplift</span>
            <span className="text-sm font-semibold text-amber-700">{fmtPay(period.premiumUpliftPay)}</span>
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
