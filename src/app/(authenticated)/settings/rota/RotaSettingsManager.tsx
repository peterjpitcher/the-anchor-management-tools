'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { updateRotaSettings, type RotaSettings } from '@/app/actions/rota-settings';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface RotaSettingsManagerProps {
  initialSettings: RotaSettings;
  canManage: boolean;
}

export default function RotaSettingsManager({ initialSettings, canManage }: RotaSettingsManagerProps) {
  const [holidayMonth, setHolidayMonth] = useState(initialSettings.holidayYearStartMonth.toString());
  const [holidayDay, setHolidayDay]     = useState(initialSettings.holidayYearStartDay.toString());
  const [defaultDays, setDefaultDays]   = useState(initialSettings.defaultHolidayDays.toString());
  const [managerEmail, setManagerEmail]       = useState(initialSettings.managerEmail);
  const [accountantEmail, setAccountantEmail] = useState(initialSettings.accountantEmail);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    const month = parseInt(holidayMonth);
    const day   = parseInt(holidayDay);
    const days  = parseInt(defaultDays);

    if (!month || month < 1 || month > 12) { toast.error('Holiday year start month must be 1–12'); return; }
    if (!day   || day < 1   || day > 31)   { toast.error('Holiday year start day must be 1–31'); return; }
    if (!days  || days < 1  || days > 365) { toast.error('Default holiday allowance must be between 1 and 365'); return; }

    startTransition(async () => {
      const result = await updateRotaSettings({
        holidayYearStartMonth: month,
        holidayYearStartDay: day,
        defaultHolidayDays: days,
        managerEmail: managerEmail.trim(),
        accountantEmail: accountantEmail.trim(),
      });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Rota settings saved');
    });
  };

  return (
    <div className="space-y-8">
      {/* Holiday year */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Holiday Year</h3>
        <p className="text-xs text-gray-500 mb-4">
          The date on which the annual holiday entitlement resets. Defaults to 6 April (UK tax year).
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <FormGroup label="Start month" htmlFor="holiday-month" className="min-w-[140px]">
            <select
              id="holiday-month"
              value={holidayMonth}
              onChange={e => setHolidayMonth(e.target.value)}
              disabled={!canManage}
              className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white disabled:bg-gray-50 disabled:text-gray-400"
            >
              {MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </FormGroup>
          <FormGroup label="Start day" htmlFor="holiday-day" className="w-24">
            <Input
              id="holiday-day"
              type="number"
              min="1"
              max="31"
              value={holidayDay}
              onChange={e => setHolidayDay(e.target.value)}
              disabled={!canManage}
            />
          </FormGroup>
        </div>
      </div>

      {/* Default allowance */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Default Holiday Allowance</h3>
        <p className="text-xs text-gray-500 mb-4">
          Used when an employee has no personal allowance set in their pay settings.
        </p>
        <FormGroup label="Days per year" htmlFor="default-days" className="w-40">
          <Input
            id="default-days"
            type="number"
            min="1"
            max="365"
            value={defaultDays}
            onChange={e => setDefaultDays(e.target.value)}
            disabled={!canManage}
          />
        </FormGroup>
      </div>

      {/* Email addresses */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Email Addresses</h3>
        <p className="text-xs text-gray-500 mb-4">
          Where automated rota and payroll emails are sent. These override any environment variable fallbacks.
        </p>
        <div className="space-y-4 max-w-md">
          <FormGroup label="Rota manager alert email" htmlFor="manager-email">
            <Input
              id="manager-email"
              type="email"
              placeholder="manager@example.com"
              value={managerEmail}
              onChange={e => setManagerEmail(e.target.value)}
              disabled={!canManage}
            />
          </FormGroup>
          <FormGroup label="Payroll accountant email" htmlFor="accountant-email">
            <Input
              id="accountant-email"
              type="email"
              placeholder="accountant@example.com"
              value={accountantEmail}
              onChange={e => setAccountantEmail(e.target.value)}
              disabled={!canManage}
            />
          </FormGroup>
        </div>
      </div>

      {canManage && (
        <Button type="button" onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save settings'}
        </Button>
      )}
    </div>
  );
}
