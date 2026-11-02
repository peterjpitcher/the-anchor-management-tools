import type { ReactNode } from 'react';
import { Button, FormFooter, SubHeading } from '@/ds';

/**
 * A titled group of fields inside an onboarding step (GP details, allergies, a contact, a set of
 * dates). Two things at once: a fieldset, so a screen reader announces the group with each field
 * (the two emergency contacts and the sets of dates ask for the same fields), and a real
 * sub-heading, so the parts of a long step can be jumped between. The legend holds the heading
 * and adds no styling of its own. The step's card has no CardHeader (the step name is the page
 * title), so the heading is an h3. `disabled` switches off every control in the group at once.
 */
export function StepSection({
  title,
  required,
  disabled,
  children,
}: {
  title: string;
  required?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend>
        <SubHeading as="h3">
          {title}
          {required ? <span className="ml-1 text-danger" aria-hidden="true">*</span> : null}
        </SubHeading>
      </legend>
      {children}
    </fieldset>
  );
}

/** What a starter reads when a step's save throws rather than returning an error. */
export const STEP_THROWN_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * The message for a save that threw (a dropped connection, or a server error the action did not
 * catch). Thrown text is not written for starters and can carry raw server detail, so it goes to
 * the console only. An action's own returned `error` is written for them and is shown as it is.
 */
export function thrownStepError(step: string, caught: unknown): string {
  console.error(`[onboarding] ${step} failed:`, caught);
  return STEP_THROWN_ERROR_MESSAGE;
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
