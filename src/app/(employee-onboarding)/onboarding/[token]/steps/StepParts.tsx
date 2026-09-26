import type { ReactNode } from 'react';
import { Button, FormFooter } from '@/ds';

/**
 * A titled group of fields inside an onboarding step (GP details, allergies, a contact). A
 * fieldset, so a screen reader announces the group with each field; the legend is styled as a
 * card-level title.
 */
export function StepSection({ title, required, children }: { title: string; required?: boolean; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-text-strong">
        {title}
        {required ? <span className="ml-1 text-danger" aria-hidden="true">*</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * The end of every onboarding step: Back (from the second step on) and the step's own submit
 * button, in the one form footer the app uses everywhere.
 */
export function StepFooter({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <FormFooter>
      {onBack ? (
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : null}
      {children}
    </FormFooter>
  );
}
