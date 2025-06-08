'use client';

import type { EmployeeHealthRecord } from '@/types/database';

interface HealthRecordsTabProps {
  healthRecord: EmployeeHealthRecord | null;
}

const DetailItem = ({ label, value }: { label: string; value: string | undefined | null | boolean }) => (
  <div className="py-3 sm:grid sm:grid-cols-4 sm:gap-4">
    <dt className="text-sm font-medium text-gray-500">{label}</dt>
    <dd className="mt-1 text-sm text-gray-900 sm:col-span-3 sm:mt-0">
      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : (value || 'N/A')}
    </dd>
  </div>
);

export default function HealthRecordsTab({ healthRecord }: HealthRecordsTabProps) {
  const details = [
    { label: 'Doctor Name', value: healthRecord?.doctor_name },
    { label: 'Doctor Address', value: healthRecord?.doctor_address },
    { label: 'Allergies', value: healthRecord?.allergies },
    { label: 'History of Illness', value: healthRecord?.illness_history },
    { label: 'Recent Treatment (last 3 months)', value: healthRecord?.recent_treatment },
  ];

  const conditions = [
    { label: 'Suffer with Diabetes?', value: healthRecord?.has_diabetes ?? false },
    { label: 'Suffer with Epilepsy/Fits/Blackouts?', value: healthRecord?.has_epilepsy ?? false },
    { label: 'Suffer with Eczema/Dermatitis/Skin Disease?', value: healthRecord?.has_skin_condition ?? false },
    { label: 'Suffer with Depressive Illness?', value: healthRecord?.has_depressive_illness ?? false },
    { label: 'Suffer with Bowel Problems?', value: healthRecord?.has_bowel_problems ?? false },
    { label: 'Suffer with Earache or Infection?', value: healthRecord?.has_ear_problems ?? false },
  ];
  
  const disabilityDetails = [
      { label: 'Registered Disabled?', value: healthRecord?.is_registered_disabled ?? false },
      ...((healthRecord?.is_registered_disabled) ? [
          { label: 'Disability Registration Number', value: healthRecord.disability_reg_number },
          { label: 'Registration Expiry Date', value: healthRecord.disability_reg_expiry_date ? new Date(healthRecord.disability_reg_expiry_date).toLocaleDateString() : 'N/A' },
          { label: 'Disability Details', value: healthRecord.disability_details },
      ] : [
          { label: 'Disability Registration Number', value: 'N/A' },
          { label: 'Registration Expiry Date', value: 'N/A' },
          { label: 'Disability Details', value: 'N/A' },
      ])
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Confidential Health Records</h3>
          <p className="mt-1 text-sm text-gray-600">
            Confidential health and medical information.
          </p>
        </div>
        {/* Placeholder for future "Edit" button */}
      </div>
      
      <dl className="sm:divide-y sm:divide-gray-200">
        {details.map(item => <DetailItem key={item.label} {...item} />)}
        {conditions.map(item => <DetailItem key={item.label} {...item} />)}
        {disabilityDetails.map(item => <DetailItem key={item.label} {...item} />)}
      </dl>
    </div>
  );
} 