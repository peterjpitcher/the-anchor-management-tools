'use client';

import { useState } from 'react';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';

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
  onSuccess: (data: HealthData) => void;
}

export default function HealthStep({ token, onSuccess }: HealthStepProps) {
  const [data, setData] = useState<HealthData>({
    doctor_name: '',
    doctor_address: '',
    has_allergies: false,
    allergies: '',
    had_absence_over_2_weeks_last_3_years: false,
    had_outpatient_treatment_over_3_months_last_3_years: false,
    absence_or_treatment_details: '',
    illness_history: '',
    recent_treatment: '',
    has_diabetes: false,
    has_epilepsy: false,
    has_skin_condition: false,
    has_depressive_illness: false,
    has_bowel_problems: false,
    has_ear_problems: false,
    is_registered_disabled: false,
    disability_reg_number: '',
    disability_reg_expiry_date: '',
    disability_details: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
        setError(result.error || 'Failed to save. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const textField = (id: keyof HealthData, label: string, type = 'text') => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={data[id] as string}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
      />
    </div>
  );

  const checkField = (id: keyof HealthData, label: string) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={data[id] as boolean}
        onChange={(e) => setData({ ...data, [id]: e.target.checked })}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );

  const textareaField = (id: keyof HealthData, label: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        id={id}
        value={data[id] as string}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        rows={3}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-800">GP Details</h3>
        {textField('doctor_name', "Doctor's Name")}
        {textareaField('doctor_address', "Doctor's Address")}
      </div>

      <hr className="border-gray-200" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Allergies</h3>
        {checkField('has_allergies', 'I have allergies')}
        {data.has_allergies && textareaField('allergies', 'Please describe your allergies')}
      </div>

      <hr className="border-gray-200" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Medical History</h3>
        {checkField('had_absence_over_2_weeks_last_3_years', 'I have had absence over 2 weeks in the last 3 years')}
        {checkField('had_outpatient_treatment_over_3_months_last_3_years', 'I have had outpatient treatment for over 3 months in the last 3 years')}
        {(data.had_absence_over_2_weeks_last_3_years || data.had_outpatient_treatment_over_3_months_last_3_years) && (
          textareaField('absence_or_treatment_details', 'Please provide details')
        )}
        {textareaField('illness_history', 'Illness history (optional)')}
        {textareaField('recent_treatment', 'Recent treatment (optional)')}
      </div>

      <hr className="border-gray-200" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Conditions</h3>
        {checkField('has_diabetes', 'Diabetes')}
        {checkField('has_epilepsy', 'Epilepsy')}
        {checkField('has_skin_condition', 'Skin condition')}
        {checkField('has_depressive_illness', 'Depressive illness')}
        {checkField('has_bowel_problems', 'Bowel problems')}
        {checkField('has_ear_problems', 'Ear problems')}
      </div>

      <hr className="border-gray-200" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Disability</h3>
        {checkField('is_registered_disabled', 'I am registered disabled')}
        {data.is_registered_disabled && (
          <>
            {textField('disability_reg_number', 'Disability registration number')}
            {textField('disability_reg_expiry_date', 'Registration expiry date', 'date')}
            {textareaField('disability_details', 'Disability details')}
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
