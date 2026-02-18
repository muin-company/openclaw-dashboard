# openclaw-dashboard

Real-time monitoring dashboard for [OpenClaw](https://openclaw.ai) AI agents.

![License](https://img.shields.io/npm/l/openclaw-dashboard)

## Features

- 📊 **Real-time monitoring** — Agent status, token usage, and costs update live via file watching
- 💰 **Cost insights** — Subscription utilization, per-model/per-agent cost breakdown
- 📈 **Charts** — Daily cost and token usage with cumulative trends (Chart.js)
- 🔄 **Auto-detection** — Reads `openclaw.json` to discover agents, models, and subscriptions
- 🌙 **Dark theme** — Clean, modern dark UI
- 🔌 **Plugin architecture** — Runs as an OpenClaw plugin (HTTP handler, RPC, CLI, slash command)

## Quick Start (30 seconds)

```bash
# 1. Install
openclaw plugins install openclaw-dashboard

# 2. Restart gateway to load the plugin
openclaw gateway restart

# 3. Open in browser
open http://localhost:3578/dashboard
```

You'll see a dark-themed dashboard with:
- **Summary cards** — Monthly subscription cost, estimated API value, total tokens, active days
- **Subscription utilization bar** — How much of your subscription you're actually using
- **Agent breakdown** — Per-agent cost and token stats
- **Daily charts** — Stacked bar charts for cost and tokens by agent/model
- **Model table** — Detailed per-model usage with pricing tier info
- **Active sessions** — Live session list with status and token counts

> **Note:** The dashboard auto-detects agents and subscriptions from your `openclaw.json`. No extra configuration needed.

## Installation

```bash
openclaw plugins install openclaw-dashboard
openclaw gateway restart
```

## Usage

### Web Dashboard
Open `http://localhost:<gateway-port>/dashboard` in your browser.

### CLI
```bash
openclaw dashboard              # Text summary
openclaw dashboard --json       # Full JSON output
openclaw dashboard --from 2026-01-01  # Date range filter
```

### Slash Command
Send `/dashboard` in any connected chat channel.

### RPC
```bash
openclaw rpc dashboard.status
openclaw rpc dashboard.snapshot '{"from":"2026-01-01"}'
```

## Configuration

In your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-dashboard": {
        "enabled": true,
        "config": {
          "basePath": "/dashboard",
          "refreshIntervalMs": 10000,
          "theme": "dark"
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `basePath` | `/dashboard` | URL path for the dashboard UI |
| `refreshIntervalMs` | `10000` | Data collection interval (ms) |
| `theme` | `dark` | Color theme (`dark` or `light`) |

## How It Works

1. **Data Collection**: Parses JSONL session files in `~/.openclaw/agents/*/sessions/` for historical cost/token data
2. **Active Sessions**: Calls `openclaw sessions --json --active 120` for live session info
3. **Auto-Detection**: Reads `openclaw.json` to discover agents, models, auth profiles, and subscriptions
4. **File Watching**: Uses `fs.watch` on session directories for near-instant updates
5. **Serving**: Registers HTTP routes on the Gateway — no separate server needed

## What It Tracks

- **Per-agent**: Cost, tokens (input/output/cache), model usage
- **Per-model**: Pricing tier, subscription vs pay-per-use classification
- **Subscriptions**: Auto-detects from auth profiles (Anthropic Max, OpenAI Plus, Google AI Pro)
- **Daily trends**: Stacked bar charts with cumulative lines
- **Active sessions**: Live session status, subagents, cron jobs

## License

MIT
