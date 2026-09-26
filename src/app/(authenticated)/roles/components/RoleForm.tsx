'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, FormFooter, Input, LinkButton, Textarea } from '@/ds';

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

  // The form is the page body, so it keeps the page's 24px rhythm between its blocks.
  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <Alert tone="danger">{state.error}</Alert>
      )}

      {initialData?.id && (
        <input type="hidden" name="roleId" value={initialData.id} />
      )}

      <Card>
        <CardHeader title="Role Details" />
        <CardBody className="space-y-4">
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
        </CardBody>
      </Card>

      <FormFooter>
        <LinkButton href="/roles" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving...' : initialData?.id ? 'Update Role' : 'Create Role'}
        </Button>
      </FormFooter>
    </form>
  );
}
