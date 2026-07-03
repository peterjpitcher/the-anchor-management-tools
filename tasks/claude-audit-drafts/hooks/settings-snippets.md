# Settings changes — exact JSON

All hook scripts install to `~/.claude/hooks/`. Backups of every touched settings file are taken first.

## Item 1 — remove stale context-mode v1.0.22 entries (`~/.claude/settings.json`)

Delete these two entries (the enabled v1.0.168 plugin registers its own via its hooks.json):

```json
// From "SessionStart" array — DELETE this object:
{"matcher":"","hooks":[{"type":"command","command":"node \"/Users/peterpitcher/.claude/plugins/cache/context-mode/context-mode/1.0.22/hooks/sessionstart.mjs\""}]}

// From "PreToolUse" array — DELETE the object whose command path contains
// /plugins/cache/context-mode/context-mode/1.0.22/hooks/pretooluse.mjs
```

Also review `context-mode-cache-heal.mjs` (SessionStart): it exists to heal exactly this drift — keep it.

## Item 4 — remove session-setup SessionStart demand (`~/.claude/settings.json`)

In the first `SessionStart` entry, delete the `session-setup.js` command (keep `gsd-check-update.js` only if GSD stays):

```json
{"type":"command","command":"node \"/Users/peterpitcher/.claude/hooks/session-setup.js\""}   // DELETE
```

Optional (same item): delete the two `session-setup-hooks.js` entries (PreToolUse Write|Edit|MultiEdit and PostToolUse Edit|Write|MultiEdit) if you want the advisory nudges gone too.

## Item 5 — remove per-edit typecheck (`/Users/peterpitcher/Cursor/.claude/settings.json`)

Delete the PostToolUse entry that runs `npx tsc --noEmit` on `Edit|Write|MultiEdit`.

## Item 11 — deploy-verify hook (`/Users/peterpitcher/Cursor/.claude/settings.json`)

```json
"PostToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "node \"/Users/peterpitcher/.claude/hooks/deploy-verify.js\"", "timeout": 5 }
    ]
  }
]
```

## Item 12 — parallel-git-guard hook (`/Users/peterpitcher/Cursor/.claude/settings.json`)

```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "node \"/Users/peterpitcher/.claude/hooks/parallel-git-guard.js\"", "timeout": 5 }
    ]
  }
]
```

(Workspace level so it covers all 21 projects; move to repo `.claude/settings.json` if you want it scoped to AMS only.)

## Item 13 — done-status Stop hook (`~/.claude/settings.json`)

```json
"Stop": [
  {
    "hooks": [
      { "type": "command", "command": "node \"/Users/peterpitcher/.claude/hooks/done-status-stop.js\"", "timeout": 10 }
    ]
  }
]
```

## Item 17 — permission cleanup

- `OJ-AnchorManagementTools/.claude/settings.local.json`: remove `"Bash(done)"` from allow list.
- `~/.claude/settings.local.json`: remove `"Bash(node /Users/peterpitcher/.claude/hooks/session-setup.js)"` (subsumed by `"Bash(node:*)"`).
