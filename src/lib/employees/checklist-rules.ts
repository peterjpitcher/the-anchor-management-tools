/**
 * Onboarding checklist items only the signing feature may tick, when the employee signs
 * (src/lib/signing/completion-hooks.ts). A hand-ticked "agreement accepted" has no signed copy
 * behind it, which is what the signing rule forbids.
 *
 * One list for both sides: updateOnboardingChecklist (src/services/employees.ts) refuses these,
 * and the checklist tab shows them as set by signing, with no tick box. Pure, so client
 * components can import it.
 */
const SIGNING_OWNED_CHECKLIST_FIELDS: readonly string[] = ['employee_agreement_accepted'];

export function isSigningOwnedChecklistField(field: string): boolean {
  return SIGNING_OWNED_CHECKLIST_FIELDS.includes(field);
}
