'use client';

import { Fragment, useState } from 'react';
import { Alert, Button, Checkbox, Field, Input, Textarea } from '@/ds';
import { StepFooter, StepSection, thrownStepError } from './StepParts';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';
import { HEALTH_CONDITION_FIELDS, HEALTH_QUESTIONS } from '@/lib/employees/health-questions';

interface HealthData {
  doctor_name: string;
  doctor_address: string;
  has_allergies: boolean;
  allergies: string;
  had_absence_over_2_weeks_last_3_years: boolean;
  had_outpatient_treatment_over_3_months_last_3_years: boolean;
  absence_or_treatment_details: string;
  illness_history: string;
  recent_treatment: string;
  has_diabetes: boolean;
  has_epilepsy: boolean;
  has_skin_condition: boolean;
  has_depressive_illness: boolean;
  has_bowel_problems: boolean;
  has_ear_problems: boolean;
  is_registered_disabled: boolean;
  disability_reg_number: string;
  disability_reg_expiry_date: string;
  disability_details: string;
}

interface HealthStepProps {
  token: string;
  /** The last saved values, from the wizard (not the page load), so Back shows what was saved. */
  initialData?: Partial<HealthData>;
  /** Already saved: unchanged answers move on without saving again. */
  saved?: boolean;
  onSuccess: (data: HealthData) => void;
  onBack?: () => void;
  /** Called when the server says this browser needs to sign in first. */
  onSignInRequired?: () => void;
}

export default function HealthStep({ token, initialData, saved = false, onSuccess, onBack, onSignInRequired }: HealthStepProps) {
  const [startingValues] = useState<HealthData>(() => ({
    doctor_name: initialData?.doctor_name ?? '',
    doctor_address: initialData?.doctor_address ?? '',
    has_allergies: initialData?.has_allergies ?? false,
    allergies: initialData?.allergies ?? '',
    had_absence_over_2_weeks_last_3_years: initialData?.had_absence_over_2_weeks_last_3_years ?? false,
    had_outpatient_treatment_over_3_months_last_3_years: initialData?.had_outpatient_treatment_over_3_months_last_3_years ?? false,
    absence_or_treatment_details: initialData?.absence_or_treatment_details ?? '',
    illness_history: initialData?.illness_history ?? '',
    recent_treatment: initialData?.recent_treatment ?? '',
    has_diabetes: initialData?.has_diabetes ?? false,
    has_epilepsy: initialData?.has_epilepsy ?? false,
    has_skin_condition: initialData?.has_skin_condition ?? false,
    has_depressive_illness: initialData?.has_depressive_illness ?? false,
    has_bowel_problems: initialData?.has_bowel_problems ?? false,
    has_ear_problems: initialData?.has_ear_problems ?? false,
    is_registered_disabled: initialData?.is_registered_disabled ?? false,
    disability_reg_number: initialData?.disability_reg_number ?? '',
    disability_reg_expiry_date: initialData?.disability_reg_expiry_date ?? '',
    disability_details: initialData?.disability_details ?? '',
  }));
  const [data, setData] = useState<HealthData>(startingValues);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Nothing changed since the last save: move on without writing it again.
    if (saved && JSON.stringify(data) === JSON.stringify(startingValues)) {
      onSuccess(data);
      return;
    }

    setLoading(true);

    try {
      const result = await saveOnboardingSection(token, 'health', {
        doctor_name: data.doctor_name || null,
        doctor_address: data.doctor_address || null,
        has_allergies: data.has_allergies,
        allergies: data.has_allergies ? (data.allergies || null) : null,
        had_absence_over_2_weeks_last_3_years: data.had_absence_over_2_weeks_last_3_years,
        had_outpatient_treatment_over_3_months_last_3_years: data.had_outpatient_treatment_over_3_months_last_3_years,
        absence_or_treatment_details: (data.had_absence_over_2_weeks_last_3_years || data.had_outpatient_treatment_over_3_months_last_3_years) ? (data.absence_or_treatment_details || null) : null,
        illness_history: data.illness_history || null,
        recent_treatment: data.recent_treatment || null,
        has_diabetes: data.has_diabetes,
        has_epilepsy: data.has_epilepsy,
        has_skin_condition: data.has_skin_condition,
        has_depressive_illness: data.has_depressive_illness,
        has_bowel_problems: data.has_bowel_problems,
        has_ear_problems: data.has_ear_problems,
        is_registered_disabled: data.is_registered_disabled,
        disability_reg_number: data.is_registered_disabled ? (data.disability_reg_number || null) : null,
        disability_reg_expiry_date: data.is_registered_disabled ? (data.disability_reg_expiry_date || null) : null,
        disability_details: data.is_registered_disabled ? (data.disability_details || null) : null,
      });

      if (result.success) {
        onSuccess(data);
      } else {
        if (result.code === 'sign_in_required') onSignInRequired?.();
        setError(result.error || 'Failed to save. Please try again.');
      }
    } catch (caught) {
      setError(thrownStepError('Saving health details', caught));
    } finally {
      setLoading(false);
    }
  };

  const textField = (id: keyof HealthData, label: string, type = 'text') => (
    <Field label={label}>
      <Input
        id={id}
        type={type}
        value={data[id] as string}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
      />
    </Field>
  );

  const checkField = (id: keyof HealthData, label: string) => (
    <Checkbox
      checked={data[id] as boolean}
      // The DS Checkbox hands the handler a boolean. The raw checkbox it replaced handed over
      // the change event, which was once written straight into state, so every health,
      // allergy and disability flag was stored as a React SyntheticEvent instead of true or false.
      onChange={(checked) => setData({ ...data, [id]: checked })}
      label={label}
    />
  );

  const textareaField = (id: keyof HealthData, label: string) => (
    <Field label={label}>
      <Textarea
        id={id}
        value={data[id] as string}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        rows={3}
      />
    </Field>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Every question here is optional: the save sends blanks as empty and unticked boxes as
          no, and neither the form nor the server requires any of them. */}
      <div className="space-y-2 text-sm text-text-muted">
        <p>
          Only managers who can edit staff records can see these answers. They help us keep you safe
          at work and make any changes you might need.
        </p>
        <p>You do not have to answer any of these questions.</p>
      </div>

      {/* The questions come from one shared list, so staff read the same question the starter
          answered (health-questions.ts). */}
      <StepSection title="GP Details">
        {textField('doctor_name', HEALTH_QUESTIONS.doctor_name)}
        {textareaField('doctor_address', HEALTH_QUESTIONS.doctor_address)}
      </StepSection>

      <hr className="border-border" />

      <StepSection title="Allergies">
        {checkField('has_allergies', HEALTH_QUESTIONS.has_allergies)}
        {data.has_allergies && textareaField('allergies', HEALTH_QUESTIONS.allergies)}
      </StepSection>

      <hr className="border-border" />

      <StepSection title="Medical History">
        {checkField('had_absence_over_2_weeks_last_3_years', HEALTH_QUESTIONS.had_absence_over_2_weeks_last_3_years)}
        {checkField('had_outpatient_treatment_over_3_months_last_3_years', HEALTH_QUESTIONS.had_outpatient_treatment_over_3_months_last_3_years)}
        {(data.had_absence_over_2_weeks_last_3_years || data.had_outpatient_treatment_over_3_months_last_3_years) && (
          textareaField('absence_or_treatment_details', HEALTH_QUESTIONS.absence_or_treatment_details)
        )}
        {textareaField('illness_history', HEALTH_QUESTIONS.illness_history)}
        {textareaField('recent_treatment', HEALTH_QUESTIONS.recent_treatment)}
      </StepSection>

      <hr className="border-border" />

      <StepSection title="Conditions">
        {HEALTH_CONDITION_FIELDS.map((field) => (
          <Fragment key={field}>{checkField(field, HEALTH_QUESTIONS[field])}</Fragment>
        ))}
      </StepSection>

      <hr className="border-border" />

      <StepSection title="Disability">
        {checkField('is_registered_disabled', HEALTH_QUESTIONS.is_registered_disabled)}
        {data.is_registered_disabled && (
          <>
            {textField('disability_reg_number', HEALTH_QUESTIONS.disability_reg_number)}
            {textField('disability_reg_expiry_date', HEALTH_QUESTIONS.disability_reg_expiry_date, 'date')}
            {textareaField('disability_details', HEALTH_QUESTIONS.disability_details)}
          </>
        )}
      </StepSection>

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          Save & Continue
        </Button>
      </StepFooter>
    </form>
  );
}
