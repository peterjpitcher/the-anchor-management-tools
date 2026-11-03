/**
 * What staff are told when a separation is cancelled. Pure module, safe to import from server and
 * client code: the cancel note and toast (server) and the Cancel Separation dialog (client) use it.
 *
 * Cancelling puts nothing back on the rota. begin_employee_separation always takes the person off
 * every rota template, and which shifts it released depends on the shift policy chosen then:
 * release_remaining opened every shift that had not started, work_remaining kept the shifts up to
 * the last working day (still theirs) and opened only the later ones. The wording said "it released
 * their shifts" for both, which sent managers to reassign shifts the person still held.
 */

type StoredSeparationShiftPolicy = 'work_remaining' | 'release_remaining'

/** The policy stored on the employee, or null when it is missing or not one we know. */
function knownPolicy(policy: string | null | undefined): StoredSeparationShiftPolicy | null {
  return policy === 'work_remaining' || policy === 'release_remaining' ? policy : null
}

/**
 * What starting the separation did to their shifts and templates, and that cancelling does not
 * undo it. Without a stored policy it says only what is true under both.
 */
export function separationCancelRotaSentence(policy: string | null | undefined): string {
  switch (knownPolicy(policy)) {
    case 'release_remaining':
      return 'Starting the separation released all their remaining shifts to open shifts and took them off every rota template. Neither comes back on its own: reassign any shifts still wanted and add them back to their templates.'
    case 'work_remaining':
      return 'Starting the separation kept their shifts up to the last working day, which are still theirs, but released any later shifts to open shifts and took them off every rota template. Neither comes back on its own: reassign any later shifts still wanted and add them back to their templates.'
    default:
      return 'Any shifts released when the separation started stay open, and starting it took them off every rota template. Neither comes back on its own: reassign any shifts still wanted and add them back to their templates.'
  }
}

/** The toast once a separation is cancelled. */
export function separationCancelledToast(policy: string | null | undefined): string {
  if (knownPolicy(policy) === 'work_remaining') {
    return 'Separation cancelled. They stay on as Active and keep their shifts up to the old last working day. Reassign any later shifts still wanted and add them back to their rota templates.'
  }
  return 'Separation cancelled. They stay on as Active. Reassign any released shifts still wanted and add them back to their rota templates.'
}
