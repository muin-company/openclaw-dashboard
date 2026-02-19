import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { OPENCLAW_BASE, loadConfig, classifyModel, determineBillingType, type OpenClawDashboardConfig } from './config.js';
import { getPricing } from './pricing.js';

export interface DashboardSnapshot {
  sessions: { subagents: any[]; cron: any[]; main: any | null };
  stats: { total: number; subagents: number; cron: number; activeSubagents: number };
  cumulative: any;
  ts: number;
}

/** Parse JSONL session files → cumulative cost/token stats */
export function parseTranscripts(dateFrom?: string | null, dateTo?: string | null) {
  const config = loadConfig();
  const agents: Record<string, any> = {};
  const dailyAgentCost: Record<string, Record<string, number>> = {};
  const dailyModelCost: Record<string, Record<string, number>> = {};
  const dailyAgentTokens: Record<string, Record<string, number>> = {};
  const dailyModelTokens: Record<string, Record<string, number>> = {};
  const agentModelMatrix: Record<string, Record<string, number>> = {};
  const modelBillingTokens: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {};
  const modelBillingCost: Record<string, number> = {};
  const modelBillingAgents: Record<string, Set<string>> = {};
  const subscriptionUsage: Record<string, number> = {};
  let totalCost = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  const activeDates = new Set<string>();

  let agentDirs: string[];
  try { agentDirs = fs.readdirSync(OPENCLAW_BASE); } catch { return null; }

  for (const agentDir of agentDirs) {
    const sessionsDir = path.join(OPENCLAW_BASE, agentDir, 'sessions');
    if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) continue;

    const pluginConfig = config.pluginConfig || {};
    const agentAliases: Record<string, string> = pluginConfig.agentAliases || {};
    const resolvedAgent = agentAliases[agentDir] || agentDir;
    const agentCfg = config.agents[agentDir] || config.agents[resolvedAgent] || {};
    const agentModel = agentCfg.model || 'unknown';

    let files: string[];
    try { files = fs.readdirSync(sessionsDir); } catch { continue; }

    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      let content: string;
      try { content = fs.readFileSync(path.join(sessionsDir, fname), 'utf8'); } catch { continue; }

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let entry: any;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.type !== 'message') continue;
        const msg = entry.message;
        if (!msg || msg.role !== 'assistant') continue;
        const usage = msg.usage;
        if (!usage || !('cost' in usage)) continue;
        const ts = entry.timestamp;
        if (!ts) continue;

        let msgDt: Date;
        try {
          msgDt = typeof ts === 'string' ? new Date(ts.replace('Z', '+00:00')) : new Date(ts);
        } catch { continue; }

        const dateStr = msgDt.toISOString().split('T')[0];
        if (dateFrom && dateStr < dateFrom) continue;
        if (dateTo && dateStr > dateTo) continue;

        const costData = usage.cost || {};
        const ocCost = typeof costData === 'object' ? (costData.total || 0) : 0;
        const inp = usage.input || 0;
        const out = usage.output || 0;
        const cr = usage.cacheRead || 0;
        const cw = usage.cacheWrite || 0;
        const messageModel = msg.model || agentModel;

        const p = getPricing(messageModel);
        const mc = (inp / 1e6) * (p.input || 0)
                 + (out / 1e6) * (p.output || 0)
                 + (cr / 1e6) * (p.cacheRead ?? (p.input || 0) * 0.1)
                 + (cw / 1e6) * (p.cacheWrite ?? (p.input || 0) * 1.25);

        const billingType = determineBillingType(ocCost, messageModel, agentDir, config);
        const { subKey } = classifyModel(messageModel, agentDir, config);
        if (subKey && billingType === 'subscription') {
          subscriptionUsage[subKey] = (subscriptionUsage[subKey] || 0) + mc;
        }

        if (!agents[resolvedAgent]) {
          agents[resolvedAgent] = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, model: agentModel };
        }
        const ad = agents[resolvedAgent];
        ad.cost += mc; ad.input += inp; ad.output += out;
        ad.cacheRead += cr; ad.cacheWrite += cw; ad.tokens += inp + out + cr;
        totalCost += mc;

        const ensure = (map: Record<string, Record<string, number>>, key: string) => { if (!map[key]) map[key] = {}; };
        ensure(dailyAgentCost, dateStr); dailyAgentCost[dateStr][resolvedAgent] = (dailyAgentCost[dateStr][resolvedAgent] || 0) + mc;
        ensure(dailyModelCost, dateStr); dailyModelCost[dateStr][messageModel] = (dailyModelCost[dateStr][messageModel] || 0) + mc;
        ensure(dailyAgentTokens, dateStr); dailyAgentTokens[dateStr][resolvedAgent] = (dailyAgentTokens[dateStr][resolvedAgent] || 0) + inp + out + cr;
        ensure(dailyModelTokens, dateStr); dailyModelTokens[dateStr][messageModel] = (dailyModelTokens[dateStr][messageModel] || 0) + inp + out + cr;
        if (!agentModelMatrix[resolvedAgent]) agentModelMatrix[resolvedAgent] = {};
        agentModelMatrix[resolvedAgent][messageModel] = (agentModelMatrix[resolvedAgent][messageModel] || 0) + mc;
        activeDates.add(dateStr);

        const mbKey = `${messageModel}|${billingType}`;
        if (!modelBillingTokens[mbKey]) modelBillingTokens[mbKey] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const mt = modelBillingTokens[mbKey];
        mt.input += inp; mt.output += out; mt.cacheRead += cr; mt.cacheWrite += cw;
        modelBillingCost[mbKey] = (modelBillingCost[mbKey] || 0) + mc;
        if (!modelBillingAgents[mbKey]) modelBillingAgents[mbKey] = new Set();
        modelBillingAgents[mbKey].add(resolvedAgent);

        if (!earliest || msgDt < earliest) earliest = msgDt;
        if (!latest || msgDt > latest) latest = msgDt;
      }
    }
  }

  // Filter zero-activity
  for (const k of Object.keys(agents)) {
    if (agents[k].cost <= 0 && agents[k].tokens <= 0) delete agents[k];
  }

  const days = earliest && latest ? Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / 86400000) + 1) : 1;
  const dailyCost = totalCost / days;

  // byModel with billing split
  const byModel: Record<string, any> = {};
  for (const [mbKey, cost] of Object.entries(modelBillingCost)) {
    const [modelName, billingType] = mbKey.split('|');
    const otherKey = `${modelName}|${billingType === 'payperuse' ? 'subscription' : 'payperuse'}`;
    const hasBoth = otherKey in modelBillingCost;
    const displayName = hasBoth ? `${modelName} (${billingType === 'payperuse' ? 'pay-per-use' : 'subscription'})` : modelName;
    const mt = modelBillingTokens[mbKey];
    byModel[displayName] = {
      agents: [...(modelBillingAgents[mbKey] || [])].sort(),
      totalCost: +cost.toFixed(4), pricing: getPricing(modelName),
      input: mt.input, output: mt.output, cacheRead: mt.cacheRead, cacheWrite: mt.cacheWrite,
      planType: billingType === 'payperuse' ? 'payperuse' : 'subscription',
      monthlyCost: +(cost / days * 30).toFixed(2),
    };
  }

  // Subscription breakdown
  const subBreakdown: Record<string, any> = {};
  for (const [key, sub] of Object.entries(config.subscriptions)) {
    const est = +(subscriptionUsage[key] || 0).toFixed(2);
    subBreakdown[key] = {
      price: sub.price, label: sub.label, estimatedApiCost: est,
      savings: +(est - sub.price).toFixed(2),
      utilization: sub.price > 0 ? +((est / sub.price) * 100).toFixed(1) : 0,
    };
  }
  const subscriptionTotal = Object.values(config.subscriptions).reduce((s, v) => s + v.price, 0);
  const totalEst = Object.values(subBreakdown).reduce((s, v) => s + v.estimatedApiCost, 0);
  const totalInput = Object.values(agents).reduce((s: number, a: any) => s + a.input, 0);
  const totalOutput = Object.values(agents).reduce((s: number, a: any) => s + a.output, 0);
  const totalCacheRead = Object.values(agents).reduce((s: number, a: any) => s + a.cacheRead, 0);
  const totalCacheWrite = Object.values(agents).reduce((s: number, a: any) => s + a.cacheWrite, 0);
  let payperUseCost = 0;
  for (const bm of Object.values(byModel)) { if (bm.planType === 'payperuse') payperUseCost += bm.totalCost; }

  const fmtDaily = (map: Record<string, Record<string, number>>) =>
    Object.keys(map).sort().map(ds => {
      const row: any = { date: ds };
      for (const [k, v] of Object.entries(map[ds])) row[k] = +v.toFixed(4);
      return row;
    });

  const byAgent: Record<string, any> = {};
  for (const [a, d] of Object.entries(agents)) {
    byAgent[a] = { cost: +d.cost.toFixed(2), tokens: d.tokens, input: d.input, output: d.output, cacheRead: d.cacheRead, cacheWrite: d.cacheWrite, model: d.model };
  }

  const matrix: Record<string, Record<string, number>> = {};
  for (const [a, models] of Object.entries(agentModelMatrix)) {
    matrix[a] = {};
    for (const [m, c] of Object.entries(models)) matrix[a][m] = +c.toFixed(4);
  }

  return {
    totalCost: +totalCost.toFixed(2), dailyCost: +dailyCost.toFixed(2), monthlyCost: +(dailyCost * 30).toFixed(2),
    daysRunning: days, activeDays: activeDates.size,
    subscriptionTotal: +subscriptionTotal.toFixed(2), subscriptionBreakdown: subBreakdown,
    utilization: subscriptionTotal > 0 ? +((totalEst / subscriptionTotal) * 100).toFixed(1) : 0,
    totalEstimatedApiCost: +totalEst.toFixed(2), payperUseCost: +payperUseCost.toFixed(2),
    totalTokens: totalInput + totalOutput + totalCacheRead,
    totalInput, totalOutput, totalCacheRead, totalCacheWrite,
    byAgent, byModel,
    dailyCostByAgent: fmtDaily(dailyAgentCost), dailyCostByModel: fmtDaily(dailyModelCost),
    dailyTokensByAgent: fmtDaily(dailyAgentTokens), dailyTokensByModel: fmtDaily(dailyModelTokens),
    agentModelMatrix: matrix,
    dateRange: { start: earliest?.toISOString() || null, end: latest?.toISOString() || null },
  };
}

/** Get active sessions via openclaw CLI */
export function getActiveSessions() {
  try {
    const result = execSync('openclaw sessions --json --active 120', { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const data = JSON.parse(result);
    const sessions: { subagents: any[]; cron: any[]; main: any | null } = { subagents: [], cron: [], main: null };

    for (const session of (data.sessions || [])) {
      const key = session.key || '';
      const ageMs = session.ageMs || 99999;
      const tokensIn = session.inputTokens || session.totalInputTokens || 0;
      const tokensOut = session.outputTokens || session.totalOutputTokens || 0;
      const model = session.model || 'unknown';
      const p = getPricing(model);
      const cost = (tokensIn / 1e6) * p.input + (tokensOut / 1e6) * p.output;
      const status = ageMs < 60000 ? 'active' : 'idle';

      const sd = {
        id: key.includes(':') ? key.split(':').pop() : key,
        key, model, updatedAt: session.updatedAt,
        ageMs, status, tokensIn, tokensOut,
        tokens: tokensIn + tokensOut, cost: +cost.toFixed(2),
        contextTokens: session.contextTokens || 0,
      };

      if (key.includes(':subagent:')) sessions.subagents.push(sd);
      else if (key.includes(':cron:')) sessions.cron.push(sd);
      else if (key === 'agent:main:main') sessions.main = sd;
    }

    return {
      sessions,
      stats: {
        total: (data.sessions || []).length,
        subagents: sessions.subagents.length,
        cron: sessions.cron.length,
        activeSubagents: sessions.subagents.filter((s: any) => s.status === 'active').length,
      },
    };
  } catch (e: any) {
    return { sessions: { subagents: [], cron: [], main: null }, stats: { total: 0, subagents: 0, cron: 0, activeSubagents: 0 }, error: e.message };
  }
}

/** Build a full snapshot */
export function buildSnapshot(dateFrom?: string | null, dateTo?: string | null): DashboardSnapshot {
  const sessData = getActiveSessions();
  const cumulative = parseTranscripts(dateFrom, dateTo);
  return { ...sessData, cumulative, ts: Date.now() };
}

/** Format a summary as text (for slash command / CLI) */
export function formatSummary(snapshot?: DashboardSnapshot): string {
  const s = snapshot || buildSnapshot();
  const c = s.cumulative;
  if (!c) return '❌ No data available';

  const lines = [
    `🔍 **OpenClaw Dashboard**`,
    ``,
    `💰 **Cost**: $${c.totalCost} total | $${c.dailyCost}/day | $${c.monthlyCost}/mo est.`,
    `📊 **Tokens**: ${fmtTokens(c.totalTokens)} (in: ${fmtTokens(c.totalInput)} / out: ${fmtTokens(c.totalOutput)})`,
    `📅 **Active**: ${c.activeDays} days (${c.daysRunning} total)`,
    `💎 **Subscription**: $${c.subscriptionTotal} → $${c.totalEstimatedApiCost} API value (${c.utilization}% util)`,
    ``,
    `**Agents**:`,
  ];

  for (const [name, data] of Object.entries<any>(c.byAgent || {})) {
    const statusEmoji = s.sessions.main?.key?.includes(name) || name === 'main' ? '🟢' : '⚪';
    lines.push(`  ${statusEmoji} ${name}: $${data.cost} | ${fmtTokens(data.tokens)} tokens`);
  }

  lines.push(``, `**Sessions**: ${s.stats.total} total | ${s.stats.subagents} subagents (${s.stats.activeSubagents} active) | ${s.stats.cron} cron`);
  return lines.join('\n');
}

function fmtTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return n.toString();
  if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
  return (n / 1e6).toFixed(2) + 'M';
}
