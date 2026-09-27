/**
 * Role badge tones: one map, used wherever a role shows as a badge (the Users table, the role
 * cards on /roles and the Manage User Roles dialog). UI_UX.md, Status.
 */

export type RoleBadgeTone = 'neutral' | 'primary'

/** A role's own name on a user: built-in (system) roles are primary, custom roles neutral. */
export const ROLE_NAME_BADGE_TONE: Record<'system' | 'custom', RoleBadgeTone> = {
  system: 'primary',
  custom: 'neutral',
}

/** The "System" flag beside a built-in role, and the "No roles" placeholder on a user. */
export const ROLE_SYSTEM_FLAG_TONE: RoleBadgeTone = 'neutral'
export const ROLE_NONE_TONE: RoleBadgeTone = 'neutral'
