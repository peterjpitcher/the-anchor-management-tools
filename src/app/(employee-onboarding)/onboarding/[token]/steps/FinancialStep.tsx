'use client';

import { useState } from 'react';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';

interface FinancialData {
  ni_number: string;
  bank_name: string;
  payee_name: string;
  branch_address: string;
  bank_sort_code: string;
  bank_sort_code_confirm: string;
  bank_account_number: string;
  bank_account_number_confirm: string;
}

interface FinancialStepProps {
  token: string;
  onSuccess: (data: Omit<FinancialData, 'bank_sort_code_confirm' | 'bank_account_number_confirm'>) => void;
}

export default function FinancialStep({ token, onSuccess }: FinancialStepProps) {
  const [data, setData] = useState<FinancialData>({
    ni_number: '',
    bank_name: '',
    payee_name: '',
    branch_address: '',
    bank_sort_code: '',
    bank_sort_code_confirm: '',
    bank_account_number: '',
    bank_account_number_confirm: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FinancialData, string>>>({});
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FinancialData, string>> = {};

    if (data.bank_sort_code && data.bank_sort_code !== data.bank_sort_code_confirm) {
      newErrors.bank_sort_code_confirm = 'Sort codes do not match.';
    }
    if (data.bank_account_number && data.bank_account_number !== data.bank_account_number_confirm) {
      newErrors.bank_account_number_confirm = 'Account numbers do not match.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const result = await saveOnboardingSection(token, 'financial', {
        ni_number: data.ni_number || null,
        bank_name: data.bank_name || null,
        payee_name: data.payee_name || null,
        branch_address: data.branch_address || null,
        bank_sort_code: data.bank_sort_code || null,
        bank_account_number: data.bank_account_number || null,
      });

      if (result.success) {
        const { bank_sort_code_confirm, bank_account_number_confirm, ...saved } = data;
        onSuccess(saved);
      } else {
        setGlobalError(result.error || 'Failed to save. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const field = (
    id: keyof FinancialData,
    label: string,
    type = 'text'
  ) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={data[id]}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        className={`block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 ${
          errors[id] ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-green-500'
        }`}
      />
      {errors[id] && <p className="mt-1 text-xs text-red-600">{errors[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-600">
        Your financial information is stored securely and used for payroll purposes only.
      </p>

      {field('ni_number', 'National Insurance Number')}
      {field('bank_name', 'Bank Name')}
      {field('payee_name', 'Payee Name (name on account)')}
      {field('branch_address', 'Branch Address')}

      <hr className="border-gray-200" />

      <div className="grid grid-cols-2 gap-4">
        {field('bank_sort_code', 'Sort Code')}
        {field('bank_sort_code_confirm', 'Confirm Sort Code')}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {field('bank_account_number', 'Account Number')}
        {field('bank_account_number_confirm', 'Confirm Account Number')}
      </div>

      {globalError && <p className="text-sm text-red-600">{globalError}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  );
}
