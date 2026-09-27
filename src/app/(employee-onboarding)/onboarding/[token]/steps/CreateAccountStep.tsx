'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/ds';
import { StepFooter } from './StepParts';
import { createEmployeeAccount } from '@/app/actions/employeeInvite';

interface CreateAccountStepProps {
  token: string;
  email: string;
  onSuccess: () => void;
  description?: string;
  buttonLabel?: string;
  onBack?: () => void;
}

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await createEmployeeAccount(token, password);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error || 'Failed to create account.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create account.');
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

      <Field label="Password">
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
      </Field>

      <Field label="Confirm Password">
        <Input
          id="confirm-password"
          type="password"
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
