'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/ds';
import { StepFooter, StepSection, thrownStepError } from './StepParts';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';

interface ContactData {
  name: string;
  relationship: string;
  phone_number: string;
  mobile_number: string;
  address: string;
}

interface EmergencyContactsData {
  primary: ContactData;
  secondary: ContactData;
}

type ContactKey = 'primary' | 'secondary';
/** Keyed "primary.name", "secondary.phone_number" and so on, as the server keys them. */
type ContactErrors = Record<string, string>;

interface EmergencyContactsStepProps {
  token: string;
  /** The last saved values, from the wizard (not the page load), so Back shows what was saved. */
  initialData?: EmergencyContactsData;
  /** Already saved and complete: unchanged values move on without saving again. */
  saved?: boolean;
  onSuccess: (data: EmergencyContactsData) => void;
  onBack?: () => void;
  /** Called when the server says this browser needs to sign in first. */
  onSignInRequired?: () => void;
}

const emptyContact = (): ContactData => ({
  name: '',
  relationship: '',
  phone_number: '',
  mobile_number: '',
  address: '',
});

const CHECK_FIELDS_MESSAGE = 'Please check the fields marked below.';

// Labels written out, not built from the field names ("phone number" in lower case).
const CONTACT_FIELDS: Array<{ key: keyof ContactData; label: string; type: string }> = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'relationship', label: 'Relationship', type: 'text' },
  { key: 'phone_number', label: 'Phone Number', type: 'tel' },
  { key: 'mobile_number', label: 'Mobile Number', type: 'tel' },
  { key: 'address', label: 'Address', type: 'text' },
];

function trimContact(contact: ContactData): ContactData {
  return {
    name: contact.name.trim(),
    relationship: contact.relationship.trim(),
    phone_number: contact.phone_number.trim(),
    mobile_number: contact.mobile_number.trim(),
    address: contact.address.trim(),
  };
}

function validateContacts(data: EmergencyContactsData): ContactErrors {
  const errors: ContactErrors = {};
  if (!data.primary.name) errors['primary.name'] = 'Primary contact name is required';
  // A contact we cannot ring is no use in an emergency. The server checks this too.
  if (!data.primary.phone_number && !data.primary.mobile_number) {
    errors['primary.phone_number'] = 'Add a phone or mobile number for your main contact.';
  }
  // A second contact is only saved with a name, so details typed without one would vanish.
  const { name, ...rest } = data.secondary;
  if (!name && Object.values(rest).some(Boolean)) {
    errors['secondary.name'] = 'Add a name for this contact, or clear their details.';
  }
  return errors;
}

export default function EmergencyContactsStep({
  token,
  initialData,
  saved = false,
  onSuccess,
  onBack,
  onSignInRequired,
}: EmergencyContactsStepProps) {
  const [startingValues] = useState<EmergencyContactsData>(() => ({
    primary: initialData?.primary ?? emptyContact(),
    secondary: initialData?.secondary ?? emptyContact(),
  }));
  const [data, setData] = useState<EmergencyContactsData>(startingValues);
  const [fieldErrors, setFieldErrors] = useState<ContactErrors>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const values: EmergencyContactsData = {
      primary: trimContact(data.primary),
      secondary: trimContact(data.secondary),
    };

    const errors = validateContacts(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(CHECK_FIELDS_MESSAGE);
      return;
    }

    const unchanged = JSON.stringify(values) === JSON.stringify({
      primary: trimContact(startingValues.primary),
      secondary: trimContact(startingValues.secondary),
    });
    if (saved && unchanged) {
      onSuccess(values);
      return;
    }

    setLoading(true);
    try {
      const toPayload = (contact: ContactData) => ({
        name: contact.name,
        relationship: contact.relationship || null,
        phone_number: contact.phone_number || null,
        mobile_number: contact.mobile_number || null,
        address: contact.address || null,
      });
      const payload: { primary: ReturnType<typeof toPayload>; secondary?: ReturnType<typeof toPayload> } = {
        primary: toPayload(values.primary),
      };
      if (values.secondary.name) {
        payload.secondary = toPayload(values.secondary);
      }

      const result = await saveOnboardingSection(token, 'emergency_contacts', payload);
      if (result.success) {
        // A second contact saved without a name is dropped, so hand on what was actually kept.
        onSuccess(values.secondary.name ? values : { ...values, secondary: emptyContact() });
      } else {
        if (result.code === 'sign_in_required') onSignInRequired?.();
        const serverErrors = result.fieldErrors ?? {};
        setFieldErrors(serverErrors);
        setError(Object.keys(serverErrors).length > 0 ? CHECK_FIELDS_MESSAGE : (result.error || 'Failed to save. Please try again.'));
      }
    } catch (caught) {
      setError(thrownStepError('Saving emergency contacts', caught));
    } finally {
      setLoading(false);
    }
  };

  const renderContactFields = (
    contactKey: ContactKey,
    label: string,
    values: ContactData,
    onChange: (field: keyof ContactData, value: string) => void,
    required = false
  ) => (
    <StepSection title={label} required={required}>
      {required ? (
        <p className="text-sm text-text-muted">We need at least one phone number for them.</p>
      ) : null}
      {CONTACT_FIELDS.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          required={field.key === 'name' && required}
          error={fieldErrors[`${contactKey}.${field.key}`]}
        >
          <Input
            id={`${contactKey}-${field.key}`}
            type={field.type}
            // Someone else's details: stop the browser offering the starter's own.
            autoComplete="off"
            value={values[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
            required={field.key === 'name' && required}
          />
        </Field>
      ))}
    </StepSection>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {renderContactFields(
        'primary',
        'Primary Contact',
        data.primary,
        (field, value) => setData({ ...data, primary: { ...data.primary, [field]: value } }),
        true
      )}

      <hr className="border-border" />

      {renderContactFields(
        'secondary',
        'Secondary Contact (Optional)',
        data.secondary,
        (field, value) => setData({ ...data, secondary: { ...data.secondary, [field]: value } }),
        false
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          Save & Continue
        </Button>
      </StepFooter>
    </form>
  );
}
