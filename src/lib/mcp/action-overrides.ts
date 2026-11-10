/**
 * Corrections to the read-only classing in src/lib/mcp/manifest/build.ts, by action name
 * (`<module>.<export>`).
 *
 * The classing is a name and body heuristic. `read` lets `run_read_action` run an action the
 * heuristic marked as a write; `write` keeps an action the heuristic marked as read only out of
 * `run_read_action`. Run `npm run mcp:manifest` after changing this file.
 */
export const ACTION_OVERRIDES: Record<string, 'read' | 'write'> = {}
