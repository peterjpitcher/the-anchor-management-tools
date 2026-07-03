#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) — item 12.
// Denies broad/destructive git operations that have twice clobbered work from
// parallel sessions/subagents (incidents 2026-07-02 and 2026-07-03; see
// feedback_parallel_session_git_hazard, feedback_parallel_agent_scope_stray).
// Escape hatch: the user runs the command themselves in a terminal.
// Install: ~/.claude/hooks/parallel-git-guard.js, wired in Cursor/.claude/settings.json.

const DENY = [
  [/\bgit\s+stash\b(?!\s+(list|show)\b)/, 'git stash (hides parallel-session edits)'],
  [/\bgit\s+add\s+(-A\b|--all\b|\.(\s|$))/, 'git add -A / --all / . (stages unrelated parallel-session changes — add explicit paths)'],
  [/\bgit\s+checkout\s+--\s/, 'git checkout -- <path> (discards working-tree edits that may belong to a parallel session)'],
  [/\bgit\s+restore\b(?![^&|;]*--staged)/, 'git restore (discards working-tree edits — use --staged to unstage instead)'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard (destroys uncommitted work)'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'git clean -f (deletes untracked files)'],
];

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (!cmd) process.exit(0);

  for (const [re, why] of DENY) {
    if (re.test(cmd)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              `Blocked by parallel-git-guard: ${why}. ` +
              'The user may be editing this tree in a parallel session. ' +
              'Stage or restore EXPLICIT file paths only, and show the diff of what you are staging first. ' +
              'If this exact command is genuinely required, ask the user to run it themselves.',
          },
        })
      );
      process.exit(0);
    }
  }
  process.exit(0);
});
