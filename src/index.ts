import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { OPENCLAW_BASE, OPENCLAW_CONFIG_PATH } from './config.js';
import { buildSnapshot, formatSummary, parseTranscripts, getActiveSessions, type DashboardSnapshot } from './collector.js';

// Plugin state
let lastSnapshot: DashboardSnapshot | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchers: fs.FSWatcher[] = [];
let pluginApi: any = null;

function collectSnapshot(dateFrom?: string | null, dateTo?: string | null): DashboardSnapshot {
  const snapshot = buildSnapshot(dateFrom, dateTo);
  lastSnapshot = snapshot;
  return snapshot;
}

function startCollector(api: any) {
  const cfg = api.pluginConfig || {};
  const intervalMs = cfg.refreshIntervalMs || 10000;

  api.logger.info(`Dashboard collector starting (interval: ${intervalMs}ms)`);

  // Initial collection
  try { collectSnapshot(); } catch (e) { api.logger.warn('Initial collection failed:', e); }

  // Periodic polling
  pollTimer = setInterval(() => {
    try { collectSnapshot(); } catch { /* silent */ }
  }, intervalMs);

  // Watch JSONL files for instant updates
  try {
    if (fs.existsSync(OPENCLAW_BASE)) {
      for (const agentDir of fs.readdirSync(OPENCLAW_BASE)) {
        const sessDir = path.join(OPENCLAW_BASE, agentDir, 'sessions');
        if (fs.existsSync(sessDir)) {
          try {
            let debounce: ReturnType<typeof setTimeout> | null = null;
            const w = fs.watch(sessDir, { persistent: false }, (_event, filename) => {
              if (filename?.endsWith('.jsonl')) {
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => { try { collectSnapshot(); } catch {} }, 2000);
              }
            });
            watchers.push(w);
          } catch { /* fs.watch limits */ }
        }
      }
    }
  } catch { /* silent */ }
}

function stopCollector() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const w of watchers) { try { w.close(); } catch {} }
  watchers = [];
}

/** Serve static files from public/ directory */
function serveDashboardAssets(basePath: string) {
  const publicDir = path.join(__dirname, '..', 'public');

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = req.url || '/';
    if (!url.startsWith(basePath)) return false;

    let relPath = url.slice(basePath.length) || '/';
    if (relPath === '' || relPath === '/') relPath = '/index.html';

    // Strip query string
    const qIdx = relPath.indexOf('?');
    if (qIdx !== -1) relPath = relPath.slice(0, qIdx);

    const filePath = path.join(publicDir, relPath);

    // Security: prevent path traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403); res.end('Forbidden'); return true;
    }

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) { res.writeHead(404); res.end('Not found'); return true; }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };

      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
      return true;
    } catch {
      res.writeHead(404); res.end('Not found'); return true;
    }
  };
}

// ── Plugin entry point ──────────────────────────────────────────────

export default function register(api: any) {
  pluginApi = api;
  const cfg = api.pluginConfig || {};
  const basePath = cfg.basePath || '/dashboard';

  // 1. Background service: data collector
  api.registerService({
    id: 'dashboard-collector',
    start: () => startCollector(api),
    stop: () => stopCollector(),
  });

  // 2. HTTP handler: serve dashboard UI
  api.registerHttpHandler(serveDashboardAssets(basePath));

  // 3. HTTP API routes (JSON endpoints)
  api.registerHttpRoute({
    path: `${basePath}/api/sessions`,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const dateFrom = url.searchParams.get('from');
        const dateTo = url.searchParams.get('to');
        const snapshot = collectSnapshot(dateFrom, dateTo);
        const body = JSON.stringify({ success: true, ...snapshot });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    },
  });

  // Config API: GET current config, POST to update subscriptions
  api.registerHttpRoute({
    path: `${basePath}/api/config`,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        try {
          const raw = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
          const subs = raw.plugins?.entries?.['openclaw-dashboard']?.config?.subscriptions || {};
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, subscriptions: subs }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { subscriptions } = JSON.parse(body);
            const raw = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
            if (!raw.plugins) raw.plugins = {};
            if (!raw.plugins.entries) raw.plugins.entries = {};
            if (!raw.plugins.entries['openclaw-dashboard']) raw.plugins.entries['openclaw-dashboard'] = {};
            if (!raw.plugins.entries['openclaw-dashboard'].config) raw.plugins.entries['openclaw-dashboard'].config = {};
            raw.plugins.entries['openclaw-dashboard'].config.subscriptions = subscriptions;
            fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf8');
            // Re-collect to pick up changes
            try { collectSnapshot(); } catch {}
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    },
  });

  api.registerHttpRoute({
    path: `${basePath}/api/health`,
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'openclaw-dashboard' }));
    },
  });

  // 4. RPC methods
  api.registerGatewayMethod('dashboard.status', ({ respond }: any) => {
    const snapshot = lastSnapshot || collectSnapshot();
    respond(true, {
      summary: formatSummary(snapshot),
      stats: snapshot.stats,
      totalCost: snapshot.cumulative?.totalCost,
      utilization: snapshot.cumulative?.utilization,
    });
  });

  api.registerGatewayMethod('dashboard.sessions', ({ respond }: any) => {
    const snapshot = lastSnapshot || collectSnapshot();
    respond(true, { sessions: snapshot.sessions, stats: snapshot.stats });
  });

  api.registerGatewayMethod('dashboard.snapshot', ({ respond, params }: any) => {
    const snapshot = collectSnapshot(params?.from, params?.to);
    respond(true, snapshot);
  });

  // 5. CLI command
  api.registerCli(({ program }: any) => {
    program
      .command('dashboard')
      .description('Show agent dashboard summary')
      .option('--json', 'Output as JSON')
      .option('--from <date>', 'Start date (YYYY-MM-DD)')
      .option('--to <date>', 'End date (YYYY-MM-DD)')
      .action((opts: any) => {
        const snapshot = buildSnapshot(opts.from, opts.to);
        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2));
        } else {
          // Plain text summary
          console.log(formatSummary(snapshot).replace(/\*\*/g, ''));
        }
      });
  }, { commands: ['dashboard'] });

  // 6. Slash command (auto-reply, no LLM)
  api.registerCommand({
    name: 'dashboard',
    description: 'Show agent status summary',
    handler: () => {
      const snapshot = lastSnapshot || collectSnapshot();
      return { text: formatSummary(snapshot) };
    },
  });

  api.logger.info(`Dashboard plugin registered — UI at ${basePath}`);
}
