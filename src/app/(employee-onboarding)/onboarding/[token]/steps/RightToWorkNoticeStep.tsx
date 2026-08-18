'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox } from '@/ds';
import { acknowledgeRightToWorkNotice } from '@/app/actions/employeeInvite';

interface RightToWorkNoticeStepProps {
  token: string;
  initialAcknowledged: boolean;
  onSuccess: () => void;
}

/**
 * A notice, not a check.
 *
 * The right to work check itself is done in person by a manager who sees the original
 * documents, or online using the applicant's share code. Nothing on this screen verifies
 * anything, and the stored acknowledgement must never be presented as evidence of a check.
 * What it records is that we told the new starter what to bring, and when.
 *
 * Official terminology per the Home Office employer's guide: the worker gets a share code from
 * "Prove your right to work to an employer", and the employer uses "Check a job applicant's
 * right to work: use their share code".
 */
export default function RightToWorkNoticeStep({
  token,
  initialAcknowledged,
  onSuccess,
}: RightToWorkNoticeStepProps) {
  const [acknowledged, setAcknowledged] = useState(initialAcknowledged);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!acknowledged) {
      setError('Please tick the box to confirm you have read this.');
      return;
    }

    setLoading(true);
    try {
      const result = await acknowledgeRightToWorkNotice(token);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error || 'Could not save that. Please try again.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-muted p-4">
        <h2 className="text-base font-semibold text-text-strong">Before your first shift</h2>
        <p className="mt-2 text-sm text-text-muted">
          Before you can start any shifts, a manager needs to see your right to work documents in
          person. This is a legal check every UK employer must make, and we do it for everyone.
          Please bring your passport with you, or send us your right to work share code if you have
          an eVisa. If you are unsure what to bring, just ask and we will help. Once the check is
          done, we can put you on the rota straight away.
        </p>
      </div>

      <ul className="space-y-2 text-sm text-text-muted">
        <li>A British or Irish passport is fine even if it has expired.</li>
        <li>
          If you have an eVisa, get your share code at{' '}
          <a
            href="https://www.gov.uk/prove-right-to-work"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            gov.uk/prove-right-to-work
          </a>{' '}
          and send it to us with your date of birth. It lasts 90 days.
        </li>
        <li>We cannot accept a biometric residence permit on its own any more.</li>
      </ul>

      {error && <Alert variant="error">{error}</Alert>}

      <Checkbox
        checked={acknowledged}
        onChange={setAcknowledged}
        label="I understand I need to show my documents before I can be given any shifts"
      />

      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Save and continue
      </Button>
    </form>
  );
}
