#!/usr/bin/env node
// Stop hook — item 13.
// Blocks a turn from ending when the final assistant message is substantive
// but carries no explicit Done / Not-done status. Enforces the user's standing
// preference (b): "never leave me guessing whether you've finished".
//
// Guards:
//  - stop_hook_active: never loops (a blocked turn's retry passes through).
//  - Replies under 240 chars are exempt (short conversational answers).
//  - Accepts a generous marker set so normal completion language passes.
// Install: ~/.claude/hooks/done-status-stop.js, wired in ~/.claude/settings.json.

const fs = require('fs');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (input.stop_hook_active) process.exit(0);

  const tp = input.transcript_path;
  if (!tp || !fs.existsSync(tp)) process.exit(0);

  let lastText = '';
  try {
    const lines = fs.readFileSync(tp, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (obj.type !== 'assistant') continue;
      const content = obj.message && obj.message.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) {
        lastText = text;
        break;
      }
    }
  } catch {
    process.exit(0);
  }

  if (!lastText || lastText.length < 240) process.exit(0);

  // Look for a status marker in the closing section of the reply.
  // Window is generous: a "**Done** … Next: … You need to: …" block can run
  // well past 500 chars after the Done line (learned from a live false positive).
  const tail = lastText.slice(-1500);
  const MARKER =
    /\b(done|not done|complete[d]?|finished|shipped|deployed|blocked|nothing (left|remaining)|remaining\b|still to do|next steps?|next:|you need to)\b/i;
  if (MARKER.test(tail)) process.exit(0);

  process.stderr.write(
    'End your reply with an explicit status line: **Done** (what was delivered) ' +
      'or **Not done — <what remains and why you stopped>**. Do not add new work; just append the status.'
  );
  process.exit(2);
});
