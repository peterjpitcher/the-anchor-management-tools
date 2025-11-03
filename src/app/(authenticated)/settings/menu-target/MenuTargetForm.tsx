'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui-v2/forms/Button';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Input } from '@/components/ui-v2/forms/Input';
import { Alert } from '@/components/ui-v2/feedback/Alert';
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
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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
      setMessage({ type: 'success', text: `GP target updated to ${formatPercentage(result?.target ?? numeric / 100)}%.` });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormGroup
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
          rightElement={<span className="pr-3 text-sm text-gray-500">%</span>}
        />
      </FormGroup>

      {message && (
        <Alert variant={message.type === 'success' ? 'success' : 'error'}>
          {message.text}
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save Target'}
        </Button>
      </div>
    </form>
  );
}
