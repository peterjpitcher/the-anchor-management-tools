/**
 * The policy acknowledgements the staff training courses replaced (owner decision, 2 November
 * 2026; tasks/plan-2026-11-02-staff-training-build.md, section 2.4). Migration
 * 20261103090300_retire_policy_drafts_replaced_by_training.sql switched each one off and put a
 * `[[RETIRED: ...]]` line at the top of its wording, but whoever edits the wording can delete that
 * line. This list cannot be edited away: these templates are never switched on, rendered or sent
 * again, whatever their wording says.
 */
export const RETIRED_TEMPLATE_SLUGS: readonly string[] = ['health-and-safety', 'allergens', 'challenge-25', 'data-protection']

/** What staff are told when one of the retired templates is refused. */
export const RETIRED_TEMPLATE_MESSAGE =
  'This policy was replaced by staff training, so it cannot be switched on or sent. Staff now learn it, and confirm it, in their training courses.'

/** True for a template the staff training courses replaced (see RETIRED_TEMPLATE_SLUGS). */
export function isRetiredTemplateSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && RETIRED_TEMPLATE_SLUGS.includes(slug.trim().toLowerCase())
}
