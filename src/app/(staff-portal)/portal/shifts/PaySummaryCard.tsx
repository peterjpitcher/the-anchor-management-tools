import { Card, CardHeader, Icon, LinkButton } from '@/ds';
import { cn } from '@/lib/utils';

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
   * This is NOT payroll's PayrollRow.premiumPay (the full premium-portion pay);
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

function SummaryRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }): React.ReactElement {
  return (
    <div className="flex justify-between gap-3 px-pad-card py-1.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm font-semibold text-text', valueClassName)}>{value}</span>
    </div>
  );
}

export default function PaySummaryCard({ current }: PaySummaryCardProps): React.ReactElement {
  const period = current;
  const hasPay = period.plannedPay !== null || period.actualPay !== null || period.holidayPay !== null;

  return (
    <Card>
      <CardHeader
        title="Pay Summary"
        subtitle={period.periodLabel}
        action={
          <LinkButton
            href="#pay-disclaimer"
            variant="ghost"
            size="sm"
            icon={<Icon name="info" size={16} />}
            className="px-1.5 text-text-muted"
          >
            <span className="sr-only">Pay disclaimer</span>
          </LinkButton>
        }
      />

      <div className="divide-y divide-border py-1">
        <SummaryRow label="Planned Hours" value={fmtHours(period.plannedHours)} />
        <SummaryRow label="Actual Hours" value={fmtHours(period.actualHours)} />
        {period.plannedPay !== null && <SummaryRow label="Planned Pay" value={fmtPay(period.plannedPay)} />}
        {period.actualPay !== null && <SummaryRow label="Actual Pay" value={fmtPay(period.actualPay)} />}
        {period.premiumUpliftPay !== null && (
          <SummaryRow label="incl. premium uplift" value={fmtPay(period.premiumUpliftPay)} valueClassName="text-warning-fg" />
        )}
        {period.holidayPay !== null && (
          <SummaryRow label="Holiday Pay Earned" value={fmtPay(period.holidayPay)} valueClassName="text-success-fg" />
        )}
        {!hasPay && (
          <p className="px-pad-card py-1.5 text-xs text-warning-fg">Hourly rate not configured. Speak to your manager.</p>
        )}
      </div>
    </Card>
  );
}
