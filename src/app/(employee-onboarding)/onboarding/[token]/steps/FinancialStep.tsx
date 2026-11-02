'use client';

import { useState } from 'react';
import { Alert, Button, Input } from '@/ds';
import { StepFooter } from './StepParts';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';
import {
  ACCOUNT_NUMBER_MESSAGE,
  ACCOUNT_NUMBER_PATTERN,
  NI_NUMBER_MESSAGE,
  NI_NUMBER_PATTERN,
  SORT_CODE_MESSAGE,
  SORT_CODE_PATTERN,
  normaliseAccountNumber,
  normaliseNiNumber,
  normaliseSortCode,
} from '@/lib/employees/field-rules';
import { isMaskedValue, MASK_CHARACTER } from '@/lib/employees/onboarding-rules';

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

type SavedFinancial = Omit<FinancialData, 'bank_sort_code_confirm' | 'bank_account_number_confirm'>;

interface FinancialStepProps {
  token: string;
  /**
   * The last saved values, from the wizard (not the page load). The NI and account numbers arrive
   * masked; a mask sent back unchanged leaves the stored value alone.
   */
  initialData?: Partial<SavedFinancial>;
  /** Already saved and complete: unchanged values move on without saving again. */
  saved?: boolean;
  /** Called with what the step should show next time, with the NI and account numbers masked. */
  onSuccess: (data: SavedFinancial) => void;
  onBack?: () => void;
  /** Called when the server says this browser needs to sign in first. */
  onSignInRequired?: () => void;
}

const CHECK_FIELDS_MESSAGE = 'Please check the fields marked below.';
const HALF_EDITED_MASK_MESSAGE = 'Clear the field and type the full value, or leave it exactly as shown.';

/**
 * The format check the server applies, so a typo is caught here rather than after a round trip.
 * A mask only stands for the stored value when it is exactly the one this step was given: one more
 * digit typed after it is an edit, not "unchanged".
 */
function formatProblem(
  value: string,
  startingValue: string,
  normalise: (raw: string) => string,
  pattern: RegExp,
  message: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isMaskedValue(trimmed) && trimmed === startingValue.trim()) return null;
  if (trimmed.includes(MASK_CHARACTER)) return HALF_EDITED_MASK_MESSAGE;
  return pattern.test(normalise(trimmed)) ? null : message;
}

export default function FinancialStep({ token, initialData, saved = false, onSuccess, onBack, onSignInRequired }: FinancialStepProps) {
  const [startingValues] = useState<FinancialData>(() => ({
    ni_number: initialData?.ni_number ?? '',
    bank_name: initialData?.bank_name ?? '',
    payee_name: initialData?.payee_name ?? '',
    branch_address: initialData?.branch_address ?? '',
    bank_sort_code: initialData?.bank_sort_code ?? '',
    bank_sort_code_confirm: initialData?.bank_sort_code ?? '',
    bank_account_number: initialData?.bank_account_number ?? '',
    bank_account_number_confirm: initialData?.bank_account_number ?? '',
  }));
  const [data, setData] = useState<FinancialData>(startingValues);
  const [errors, setErrors] = useState<Partial<Record<keyof FinancialData, string>>>({});
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FinancialData, string>> = {};

    const niProblem = formatProblem(data.ni_number, startingValues.ni_number, normaliseNiNumber, NI_NUMBER_PATTERN, NI_NUMBER_MESSAGE);
    if (niProblem) newErrors.ni_number = niProblem;
    const sortCodeProblem = formatProblem(data.bank_sort_code, startingValues.bank_sort_code, normaliseSortCode, SORT_CODE_PATTERN, SORT_CODE_MESSAGE);
    if (sortCodeProblem) newErrors.bank_sort_code = sortCodeProblem;
    const accountProblem = formatProblem(data.bank_account_number, startingValues.bank_account_number, normaliseAccountNumber, ACCOUNT_NUMBER_PATTERN, ACCOUNT_NUMBER_MESSAGE);
    if (accountProblem) newErrors.bank_account_number = accountProblem;

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

    if (!validate()) {
      setGlobalError(CHECK_FIELDS_MESSAGE);
      return;
    }

    const { bank_sort_code_confirm, bank_account_number_confirm, ...values } = data;
    const { bank_sort_code_confirm: _a, bank_account_number_confirm: _b, ...startingSaved } = startingValues;

    // Nothing changed since the last save: move on without writing it again.
    if (saved && JSON.stringify(values) === JSON.stringify(startingSaved)) {
      onSuccess(values);
      return;
    }

    setLoading(true);
    try {
      const result = await saveOnboardingSection(token, 'financial', {
        ni_number: values.ni_number || null,
        bank_name: values.bank_name || null,
        payee_name: values.payee_name || null,
        branch_address: values.branch_address || null,
        bank_sort_code: values.bank_sort_code || null,
        bank_account_number: values.bank_account_number || null,
      });

      if (result.success) {
        // The server hands back the masked NI and account numbers and the tidied sort code, the
        // same as a reload would show, so going Back never replays the full numbers.
        onSuccess({
          ...values,
          ni_number: result.saved?.ni_number ?? values.ni_number,
          bank_sort_code: result.saved?.bank_sort_code ?? values.bank_sort_code,
          bank_account_number: result.saved?.bank_account_number ?? values.bank_account_number,
        });
      } else {
        if (result.code === 'sign_in_required') onSignInRequired?.();
        const serverErrors = (result.fieldErrors ?? {}) as Partial<Record<keyof FinancialData, string>>;
        setErrors(serverErrors);
        setGlobalError(Object.keys(serverErrors).length > 0 ? CHECK_FIELDS_MESSAGE : (result.error || 'Failed to save. Please try again.'));
      }
    } catch (caught) {
      setGlobalError(caught instanceof Error ? caught.message : 'Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const field = (
    id: keyof FinancialData,
    label: string,
    options: { inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; hint?: string } = {}
  ) => (
    // The Input's own label and error props, not a Field wrapper: the Input draws the danger
    // border, and links the message with aria-describedby and aria-invalid.
    <Input
      id={id}
      label={label}
      type="text"
      inputMode={options.inputMode}
      autoComplete="off"
      hint={options.hint}
      value={data[id]}
      onChange={(e) => setData({ ...data, [id]: e.target.value })}
      error={errors[id]}
    />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-text-muted">
        Your financial information is stored securely and used for payroll purposes only.
      </p>

      {field('ni_number', 'National Insurance Number', {
        hint: 'If you do not have it to hand, leave this blank and give it to your manager later.',
      })}
      {field('bank_name', 'Bank Name')}
      {field('payee_name', 'Payee Name (name on account)')}
      {field('branch_address', 'Branch Address')}

      <hr className="border-border" />

      <p className="text-sm text-text-muted">
        We need your sort code and account number before you can submit your profile, so we can pay
        you. If you do not have them to hand, save what you have and come back to this step from the
        review page.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('bank_sort_code', 'Sort Code', { inputMode: 'numeric' })}
        {field('bank_sort_code_confirm', 'Confirm Sort Code', { inputMode: 'numeric' })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('bank_account_number', 'Account Number', { inputMode: 'numeric' })}
        {field('bank_account_number_confirm', 'Confirm Account Number', { inputMode: 'numeric' })}
      </div>

      {globalError && <Alert tone="danger">{globalError}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          Save & Continue
        </Button>
      </StepFooter>
    </form>
  );
}
