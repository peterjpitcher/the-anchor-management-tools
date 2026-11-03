'use client';

import type { EmployeeHealthRecord } from '@/types/database';
import { formatDateInLondon } from '@/lib/dateUtils';
import { HEALTH_CONDITION_FIELDS, HEALTH_QUESTIONS } from '@/lib/employees/health-questions';
import { Alert, Card, CardBody, CardHeader, DescriptionList, LinkButton } from '@/ds';

interface HealthRecordsTabProps {
  employeeId: string;
  healthRecord: EmployeeHealthRecord | null;
  canEdit: boolean;
  /** The record was withheld from this viewer. Without this, every question read as "No". */
  redacted?: boolean;
  /** Why the record could not be loaded. Shown instead of a page of "No" answers. */
  loadError?: string | null;
}

type DetailValue = string | undefined | null | boolean;

function displayValue(value: DetailValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value || 'N/A';
}

export default function HealthRecordsTab({ employeeId, healthRecord, canEdit, redacted, loadError }: HealthRecordsTabProps) {
  const hasAllergies = Boolean(healthRecord?.has_allergies ?? healthRecord?.allergies)

  // Each label is the question the starter was asked in onboarding (health-questions.ts). They
  // were worded differently here, so a starter's "No" to "Epilepsy" read as "No" to fits and
  // blackouts too.
  const details: Array<{ label: string; value: DetailValue }> = [
    { label: HEALTH_QUESTIONS.doctor_name, value: healthRecord?.doctor_name },
    { label: HEALTH_QUESTIONS.doctor_address, value: healthRecord?.doctor_address },
    { label: HEALTH_QUESTIONS.has_allergies, value: hasAllergies },
    { label: HEALTH_QUESTIONS.allergies, value: healthRecord?.allergies },
    { label: HEALTH_QUESTIONS.had_absence_over_2_weeks_last_3_years, value: healthRecord?.had_absence_over_2_weeks_last_3_years ?? false },
    { label: HEALTH_QUESTIONS.had_outpatient_treatment_over_3_months_last_3_years, value: healthRecord?.had_outpatient_treatment_over_3_months_last_3_years ?? false },
    { label: HEALTH_QUESTIONS.absence_or_treatment_details, value: healthRecord?.absence_or_treatment_details },
    { label: HEALTH_QUESTIONS.illness_history, value: healthRecord?.illness_history },
    { label: HEALTH_QUESTIONS.recent_treatment, value: healthRecord?.recent_treatment },
  ];

  const conditions: Array<{ label: string; value: DetailValue }> = HEALTH_CONDITION_FIELDS.map((field) => ({
    label: HEALTH_QUESTIONS[field],
    value: healthRecord?.[field] ?? false,
  }));

  const disabilityDetails: Array<{ label: string; value: DetailValue }> = [
      { label: HEALTH_QUESTIONS.is_registered_disabled, value: healthRecord?.is_registered_disabled ?? false },
      ...((healthRecord?.is_registered_disabled) ? [
          { label: HEALTH_QUESTIONS.disability_reg_number, value: healthRecord.disability_reg_number },
          { label: HEALTH_QUESTIONS.disability_reg_expiry_date, value: healthRecord.disability_reg_expiry_date ? formatDateInLondon(healthRecord.disability_reg_expiry_date) : 'N/A' },
          { label: HEALTH_QUESTIONS.disability_details, value: healthRecord.disability_details },
      ] : [
          { label: HEALTH_QUESTIONS.disability_reg_number, value: 'N/A' },
          { label: HEALTH_QUESTIONS.disability_reg_expiry_date, value: 'N/A' },
          { label: HEALTH_QUESTIONS.disability_details, value: 'N/A' },
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
        {redacted ? (
          <p className="text-sm text-text-muted">You do not have permission to see the health record.</p>
        ) : loadError ? (
          <Alert tone="danger" title="Could not load the health record">{loadError}</Alert>
        ) : !healthRecord ? (
          // No record at all is not a page of "No" answers.
          <p className="text-sm text-text-muted">No health information has been recorded yet.</p>
        ) : (
          <DescriptionList items={items} />
        )}
      </CardBody>
    </Card>
  );
}
