'use client';

import type { EmployeeHealthRecord } from '@/types/database';
import { formatDateInLondon } from '@/lib/dateUtils';
import { Card, CardBody, CardHeader, DescriptionList, LinkButton } from '@/ds';

interface HealthRecordsTabProps {
  employeeId: string;
  healthRecord: EmployeeHealthRecord | null;
  canEdit: boolean;
}

type DetailValue = string | undefined | null | boolean;

function displayValue(value: DetailValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value || 'N/A';
}

export default function HealthRecordsTab({ employeeId, healthRecord, canEdit }: HealthRecordsTabProps) {
  const hasAllergies = Boolean(healthRecord?.has_allergies ?? healthRecord?.allergies)

  const details: Array<{ label: string; value: DetailValue }> = [
    { label: 'Doctor Name', value: healthRecord?.doctor_name },
    { label: 'Doctor Address', value: healthRecord?.doctor_address },
    { label: 'Has Allergies?', value: hasAllergies },
    { label: 'Allergy Details', value: healthRecord?.allergies },
    { label: 'Off Work 2+ Weeks (past 3 years)?', value: healthRecord?.had_absence_over_2_weeks_last_3_years ?? false },
    { label: 'Outpatient Treatment 3+ Months (past 3 years)?', value: healthRecord?.had_outpatient_treatment_over_3_months_last_3_years ?? false },
    { label: 'Absence/Treatment Details', value: healthRecord?.absence_or_treatment_details },
    { label: 'Additional Medical Notes', value: healthRecord?.illness_history },
  ];

  const conditions: Array<{ label: string; value: DetailValue }> = [
    { label: 'Suffer with Diabetes?', value: healthRecord?.has_diabetes ?? false },
    { label: 'Suffer with Epilepsy/Fits/Blackouts?', value: healthRecord?.has_epilepsy ?? false },
    { label: 'Suffer with Eczema/Dermatitis/Skin Disease?', value: healthRecord?.has_skin_condition ?? false },
    { label: 'Suffer with Depressive Illness?', value: healthRecord?.has_depressive_illness ?? false },
    { label: 'Suffer with Bowel Problems?', value: healthRecord?.has_bowel_problems ?? false },
    { label: 'Suffer with Earache or Infection?', value: healthRecord?.has_ear_problems ?? false },
  ];

  const disabilityDetails: Array<{ label: string; value: DetailValue }> = [
      { label: 'Registered Disabled?', value: healthRecord?.is_registered_disabled ?? false },
      ...((healthRecord?.is_registered_disabled) ? [
          { label: 'Disability Registration Number', value: healthRecord.disability_reg_number },
          { label: 'Registration Expiry Date', value: healthRecord.disability_reg_expiry_date ? formatDateInLondon(healthRecord.disability_reg_expiry_date) : 'N/A' },
          { label: 'Disability Details', value: healthRecord.disability_details },
      ] : [
          { label: 'Disability Registration Number', value: 'N/A' },
          { label: 'Registration Expiry Date', value: 'N/A' },
          { label: 'Disability Details', value: 'N/A' },
      ])
  ]

  const items = [...details, ...conditions, ...disabilityDetails].map((item) => ({
    key: item.label,
    label: item.label,
    value: displayValue(item.value),
  }));

  return (
    <Card>
      <CardHeader
        title="Confidential Health Records"
        subtitle="Confidential health and medical information"
        action={canEdit ? (
          <LinkButton href={`/employees/${employeeId}/edit?tab=health`} variant="secondary" size="sm">
            Edit
          </LinkButton>
        ) : undefined}
      />
      <CardBody>
        <DescriptionList items={items} />
      </CardBody>
    </Card>
  );
}
