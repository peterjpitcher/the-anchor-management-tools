/**
 * Character limits on event text that the event drawer checks as staff type and the server schemas
 * check on save, kept in one place so the two cannot disagree.
 */

/**
 * The approved access wording (website SSOT section 16, ACCESS_WORDING) is 382 characters, and the
 * category defaults and the content generator add "Assistance dogs are always welcome." (418). The old
 * limit of 300 refused every save of an event or category carrying that wording.
 */
export const ACCESSIBILITY_NOTES_MAX_LENGTH = 1000
