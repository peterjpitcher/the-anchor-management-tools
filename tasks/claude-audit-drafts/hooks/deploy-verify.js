#!/usr/bin/env node
// PostToolUse hook (matcher: Bash) — item 11.
// After any `git push`, inject a reminder that push ≠ deploy, with the exact
// verification steps. Encodes: feedback_verify_deployments, lessons.md #5.
// Install: ~/.claude/hooks/deploy-verify.js, wired in Cursor/.claude/settings.json
// (see settings-snippets.md).

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
  if (!/\bgit\s+([a-z-]+\s+)*push\b/.test(cmd)) process.exit(0);

  const context = [
    'REMINDER — push ≠ deploy. Before telling the user anything is live:',
    '1. Confirm a NEW Vercel deployment exists for this commit and reached status Ready',
    '   (`vercel ls <project>` / `vercel inspect <url>` or the deploy-verify skill).',
    '2. Confirm the production alias now points at that deployment.',
    '3. the-anchor.pub website repo is a MANUAL deploy — a push there deploys nothing.',
    'If you cannot verify, your Done/Not-done status must say "pushed, deployment unverified".',
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: context,
      },
    })
  );
  process.exit(0);
});
