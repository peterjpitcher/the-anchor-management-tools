'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Alert, Button, Card, Input, LinkButton, Textarea } from '@/ds';

interface RoleFormProps {
  action: (prevState: unknown, formData: FormData) => Promise<{ error?: string; success?: boolean }>;
  initialData?: {
    id?: string;
    name?: string;
    description?: string;
  };
}

export default function RoleForm({ action, initialData }: RoleFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      router.push('/roles');
    }
  }, [state, router]);

  return (
    <Card>
      <form action={formAction} className="space-y-6">
        {state?.error && (
          <Alert tone="danger">{state.error}</Alert>
        )}

        {initialData?.id && (
          <input type="hidden" name="roleId" value={initialData.id} />
        )}

        <Input
          type="text"
          name="name"
          id="name"
          label="Role Name"
          required
          defaultValue={initialData?.name}
          placeholder="e.g., Event Manager"
          hint="Choose a descriptive name for this role"
        />

        <Textarea
          name="description"
          id="description"
          label="Description"
          rows={3}
          defaultValue={initialData?.description}
          placeholder="Describe the purpose and responsibilities of this role"
        />

        <div className="flex justify-end gap-3">
          <LinkButton href="/roles" variant="secondary">
            Cancel
          </LinkButton>
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? 'Saving...' : initialData?.id ? 'Update Role' : 'Create Role'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
