'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, FormFooter, Input, toast } from '@/ds';
import { updateMenuTargetGp } from '@/app/actions/menu-settings';

type Props = {
  initialTarget: number;
};

const formatPercentage = (value: number) => {
  const percentage = value * 100;
  return Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1);
};

export function MenuTargetForm({ initialTarget }: Props) {
  const [value, setValue] = useState<string>(formatPercentage(initialTarget));
  // Only failures stay on the form. A successful save is a transient confirmation: a toast.
  const [message, setMessage] = useState<{ type: 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) {
      setMessage({ type: 'error', text: 'Enter a valid percentage between 1 and 95.' });
      return;
    }

    startTransition(async () => {
      const result = await updateMenuTargetGp(numeric);
      if (result?.error) {
        setMessage({ type: 'error', text: result.error });
        return;
      }

      if (result?.target) {
        setValue(formatPercentage(result.target));
      }
      setMessage(null);
      toast.success(`GP target updated to ${formatPercentage(result?.target ?? numeric / 100)}%.`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        label="Standard GP% target"
        help="This percentage is applied to every dish. Enter a value between 1 and 95."
        required
      >
        <Input
          type="number"
          min="1"
          max="95"
          step="0.1"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (message) {
              setMessage(null);
            }
          }}
          rightElement="%"
        />
      </Field>

      {message && (
        <Alert tone="danger">
          {message.text}
        </Alert>
      )}

      <FormFooter>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save Target'}
        </Button>
      </FormFooter>
    </form>
  );
}
