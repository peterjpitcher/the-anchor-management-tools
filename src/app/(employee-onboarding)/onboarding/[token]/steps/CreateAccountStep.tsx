'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/ds';
import { StepFooter, thrownStepError } from './StepParts';
import { createEmployeeAccount } from '@/app/actions/employeeInvite';
import { PASSWORD_MIN_LENGTH, passwordError } from '@/lib/employees/password-rule';

interface CreateAccountStepProps {
  token: string;
  email: string;
  /** `signedIn` is false when the account was made but this browser could not be signed in. */
  onSuccess: (signedIn: boolean) => void;
  description?: string;
  buttonLabel?: string;
  onBack?: () => void;
}

type PasswordField = 'password' | 'confirm';

export default function CreateAccountStep({
  token,
  email,
  onSuccess,
  description,
  buttonLabel = 'Create Account & Continue',
  onBack,
}: CreateAccountStepProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    // The same rule the server applies (password-rule.ts); the server is the one that counts.
    const problem = passwordError(password);
    if (problem) {
      setFieldErrors({ password: problem });
      return;
    }
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Passwords do not match.' });
      return;
    }

    setLoading(true);
    try {
      const result = await createEmployeeAccount(token, password);
      if (result.success) {
        onSuccess(result.signedIn !== false);
      } else if (result.code === 'sign_in_required') {
        // The account already exists, so carry on as if it had just been made without a session:
        // the page asks them to sign in.
        onSuccess(false);
      } else if (result.fieldErrors?.password) {
        setFieldErrors({ password: result.fieldErrors.password });
      } else {
        setError(result.error || 'Failed to create account.');
      }
    } catch (caught) {
      setError(thrownStepError('Creating the account', caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-text-muted">
        {description ?? (
          <>
            Create a password for your account. You&apos;ll use your email address (<strong>{email}</strong>) and this password to sign in.
          </>
        )}
      </p>

      {/* The account's username, so a password manager saves the new password against this email. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <Field
        label="Password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few words strung together is easy to remember.`}
        error={fieldErrors.password}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={PASSWORD_MIN_LENGTH}
        />
      </Field>

      <Field label="Confirm Password" error={fieldErrors.confirm}>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="Re-enter your password"
        />
      </Field>

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          {buttonLabel}
        </Button>
      </StepFooter>
    </form>
  );
}
