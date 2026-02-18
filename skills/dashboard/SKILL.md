# Dashboard Skill

Use the `/dashboard` command to get a quick text summary of agent status, costs, and sessions.

The full dashboard UI is available at the Gateway's `/dashboard` path.

## Slash Command
- `/dashboard` — Returns a text summary of current agent status

## RPC Methods (via Gateway)
- `dashboard.status` — Get summary + stats
- `dashboard.sessions` — Get active sessions
- `dashboard.snapshot` — Get full data snapshot (accepts `from`/`to` params)

## CLI
- `openclaw dashboard` — Print summary to terminal
- `openclaw dashboard --json` — Full JSON output
- `openclaw dashboard --from 2026-01-01 --to 2026-01-31` — Date range
