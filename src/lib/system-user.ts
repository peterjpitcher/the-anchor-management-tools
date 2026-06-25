/**
 * Sentinel UUID used to attribute writes made by automated/system processes
 * (webhooks, crons) where there is no logged-in user.
 *
 * The `cashup_sessions.*_by_user_id` columns are NOT NULL but have no foreign
 * key, so a stable sentinel UUID satisfies the constraint while remaining
 * recognisable and filterable in audit trails. Override via `SYSTEM_USER_ID`
 * if you later seed a real system user (and add an FK).
 */
export const SYSTEM_USER_ID =
  process.env.SYSTEM_USER_ID?.trim() || '00000000-0000-0000-0000-000000000000'
