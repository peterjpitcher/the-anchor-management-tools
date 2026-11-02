'use client';

import { useState } from 'react';
import { Alert, Badge, Button, DescriptionList, Icon, SubHeading, type DescriptionListItem } from '@/ds';
import { submitOnboardingProfile, type OnboardingSnapshot } from '@/app/actions/employeeInvite';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/dateUtils';
import { ONBOARDING_INCOMPLETE_MESSAGES, type OnboardingSectionKey } from '@/lib/employees/onboarding-rules';
import {
  ONBOARDING_SECTION_ICON,
  ONBOARDING_SECTION_LABEL,
  ONBOARDING_SECTION_TONE,
  type OnboardingSectionState,
} from '../../_shared/status-ui';
import { StepFooter } from './StepParts';

type OnboardingValues = Omit<OnboardingSnapshot, 'completedSections'>;

interface ReviewStepProps {
  token: string;
  /** What the starter has saved, from the wizard, with the NI and account numbers masked. */
  values: OnboardingValues;
  savedSections: Record<OnboardingSectionKey, boolean>;
  onBack?: () => void;
  /** Opens that section's step; saving it comes back here. */
  onEdit?: (section: OnboardingSectionKey) => void;
  /** Called when the server says this browser needs to sign in first. */
  onSignInRequired?: () => void;
  /** Called when the server says a section is not complete after all. */
  onIncomplete?: (section: OnboardingSectionKey) => void;
}

const NOT_GIVEN = 'Not given';

const LEAVE_TYPE_LABELS: Record<string, string> = {
  holiday: 'Holiday',
  unavailable: 'Cannot work (not holiday)',
};

function text(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : NOT_GIVEN;
}

function date(value: string | null | undefined): string {
  return value ? formatDate(value) : NOT_GIVEN;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function personalItems(personal: OnboardingValues['personal']): DescriptionListItem[] {
  return [
    { key: 'name', label: 'Name', value: text([personal.first_name, personal.last_name].filter(Boolean).join(' ')) },
    { key: 'preferred', label: 'Preferred Name', value: text(personal.preferred_name) },
    { key: 'dob', label: 'Date of Birth', value: date(personal.date_of_birth) },
    { key: 'address', label: 'Address', value: text([personal.address, personal.post_code].filter(Boolean).join(', ')) },
    { key: 'phone', label: 'Phone Number', value: text(personal.phone_number) },
    { key: 'mobile', label: 'Mobile Number', value: text(personal.mobile_number) },
  ];
}

function timeOffItems(timeOff: OnboardingValues['time_off']): DescriptionListItem[] {
  if (timeOff.answer === 'none') {
    return [{ key: 'answer', label: 'Time Off', value: 'Nothing booked', span: 2 }];
  }
  if (timeOff.answer !== 'has_dates' || timeOff.blocks.length === 0) {
    return [{ key: 'answer', label: 'Time Off', value: 'Not answered yet', span: 2 }];
  }
  return timeOff.blocks.map((block, index) => {
    const range = block.startDate === block.endDate
      ? date(block.startDate)
      : `${date(block.startDate)} to ${date(block.endDate)}`;
    const type = LEAVE_TYPE_LABELS[block.leaveType] ?? block.leaveType;
    return {
      key: `block-${index}`,
      label: `Dates ${index + 1}`,
      value: `${range}, ${type}${block.note ? ` (${block.note})` : ''}`,
      span: 2,
    };
  });
}

function contactValue(contact: OnboardingValues['emergency_contacts']['primary']): string {
  const name = contact.name.trim();
  if (!name) return NOT_GIVEN;
  const relationship = contact.relationship.trim();
  const numbers = [contact.phone_number, contact.mobile_number].map((value) => value.trim()).filter(Boolean).join(' or ');
  return `${name}${relationship ? ` (${relationship})` : ''}, ${numbers || 'no phone number'}`;
}

function contactItems(contacts: OnboardingValues['emergency_contacts']): DescriptionListItem[] {
  const items: DescriptionListItem[] = [
    { key: 'primary', label: 'Primary Contact', value: contactValue(contacts.primary), span: 2 },
  ];
  if (contacts.secondary.name.trim()) {
    items.push({ key: 'secondary', label: 'Secondary Contact', value: contactValue(contacts.secondary), span: 2 });
  }
  return items;
}

function financialItems(financial: OnboardingValues['financial']): DescriptionListItem[] {
  return [
    {
      key: 'ni',
      label: 'National Insurance Number',
      // Masked: only enough to recognise it, never replayed in full.
      value: financial.ni_number.trim() || 'Not given. You can give it to your manager later.',
    },
    { key: 'bank', label: 'Bank Name', value: text(financial.bank_name) },
    { key: 'payee', label: 'Payee Name', value: text(financial.payee_name) },
    { key: 'sort', label: 'Sort Code', value: text(financial.bank_sort_code) },
    { key: 'account', label: 'Account Number', value: text(financial.bank_account_number) },
  ];
}

const CONDITION_LABELS: Array<[keyof OnboardingValues['health'], string]> = [
  ['has_diabetes', 'Diabetes'],
  ['has_epilepsy', 'Epilepsy'],
  ['has_skin_condition', 'Skin condition'],
  ['has_depressive_illness', 'Depressive illness'],
  ['has_bowel_problems', 'Bowel problems'],
  ['has_ear_problems', 'Ear problems'],
];

function healthItems(health: OnboardingValues['health']): DescriptionListItem[] {
  const conditions = CONDITION_LABELS.filter(([key]) => health[key] === true).map(([, label]) => label);
  return [
    { key: 'gp', label: "Doctor's Name", value: text(health.doctor_name) },
    {
      key: 'allergies',
      label: 'Allergies',
      value: health.has_allergies ? `Yes${health.allergies.trim() ? `: ${health.allergies.trim()}` : ''}` : 'No',
    },
    {
      key: 'history',
      label: 'Long Absence or Treatment',
      value: yesNo(health.had_absence_over_2_weeks_last_3_years || health.had_outpatient_treatment_over_3_months_last_3_years),
    },
    { key: 'conditions', label: 'Conditions', value: conditions.length > 0 ? conditions.join(', ') : 'None ticked' },
    { key: 'disabled', label: 'Registered Disabled', value: yesNo(health.is_registered_disabled) },
  ];
}

export default function ReviewStep({
  token,
  values,
  savedSections,
  onBack,
  onEdit,
  onSignInRequired,
  onIncomplete,
}: ReviewStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await submitOnboardingProfile(token);
      if (result.success) {
        router.push('/onboarding/success');
      } else {
        if (result.code === 'sign_in_required') onSignInRequired?.();
        if (result.section) onIncomplete?.(result.section);
        setError(result.error || 'Failed to submit. Please try again.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sections: Array<{ key: OnboardingSectionKey; label: string; items: DescriptionListItem[] }> = [
    { key: 'personal', label: 'Personal Details', items: personalItems(values.personal) },
    { key: 'time_off', label: 'Time Off Booked', items: timeOffItems(values.time_off) },
    { key: 'emergency_contacts', label: 'Emergency Contacts', items: contactItems(values.emergency_contacts) },
    { key: 'financial', label: 'Financial Details', items: financialItems(values.financial) },
    { key: 'health', label: 'Health Information', items: healthItems(values.health) },
    {
      key: 'right_to_work_notice',
      label: 'Right to Work',
      items: [{
        key: 'notice',
        label: 'What to Bring',
        value: values.right_to_work_notice.acknowledged
          ? 'You have confirmed you will show your documents before your first shift'
          : 'Not confirmed yet',
        span: 2,
      }],
    },
  ];

  const allComplete = sections.every((s) => savedSections[s.key]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">
        Check your details below. Use Edit to change anything. Once you submit, your profile will be activated.
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {sections.map((section) => {
          const state: OnboardingSectionState = savedSections[section.key] ? 'complete' : 'incomplete';
          return (
            <li key={section.key} className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <Icon
                  name={ONBOARDING_SECTION_ICON[state].name}
                  size={18}
                  className={ONBOARDING_SECTION_ICON[state].className}
                />
                <SubHeading as="h3">{section.label}</SubHeading>
                <Badge tone={ONBOARDING_SECTION_TONE[state]} size="sm">
                  {ONBOARDING_SECTION_LABEL[state]}
                </Badge>
                {onEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Edit ${section.label}`}
                    onClick={() => onEdit(section.key)}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
              {state === 'incomplete' ? (
                <p className="text-sm text-warning-fg">{ONBOARDING_INCOMPLETE_MESSAGES[section.key]}</p>
              ) : null}
              <DescriptionList items={section.items} columns={2} />
            </li>
          );
        })}
      </ul>

      {!allComplete && (
        <Alert tone="warning" role="status">
          Some sections still need something before you can submit. Use Edit to finish them.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={!allComplete}
          loading={loading}
        >
          Complete Profile
        </Button>
      </StepFooter>
    </div>
  );
}
