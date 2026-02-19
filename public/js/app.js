// OpenClaw Dashboard — Real-time Frontend
// Works with both WebSocket (socket.io) and REST polling fallback

const BASE_PATH = window.location.pathname.replace(/\/$/, '') || '/dashboard';
const API_URL = `${BASE_PATH}/api/sessions`;
const REFRESH_MS = 15000;
let charts = {};
let currentPeriod = 30;
let useWebSocket = false;
let socket = null;
let isLoading = true;
let lastError = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setupPeriodButtons();
  syncDateInputs();
  initConnection();
  setupSubscriptionMgmt();
});

function initConnection() {
  updateLiveStatus(false);
  showLoading(true);
  fetchData();
  setInterval(fetchData, REFRESH_MS);
}

function showLoading(show) {
  isLoading = show;
  const container = document.querySelector('.container');
  let overlay = document.getElementById('loadingOverlay');
  if (show && !overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div><div class="loading-text">Loading dashboard data...</div>';
    container.prepend(overlay);
  } else if (!show && overlay) {
    overlay.remove();
  }
}

function showError(msg) {
  let banner = document.getElementById('errorBanner');
  if (!msg) { if (banner) banner.remove(); lastError = null; return; }
  lastError = msg;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'errorBanner';
    banner.className = 'error-banner';
    document.querySelector('.container').prepend(banner);
  }
  banner.innerHTML = `<span class="error-icon">⚠️</span><span class="error-msg">${msg}</span><button class="error-retry" onclick="fetchData()">Retry</button>`;
}

function updateLiveStatus(connected) {
  const el = document.getElementById('liveStatus');
  if (connected) { el.textContent = 'LIVE'; el.style.background = '#22c55e'; }
  else { el.textContent = 'POLL'; el.style.background = '#f59e0b'; }
}

function showChanges(changes) {
  const container = document.getElementById('toastContainer');
  for (const c of changes) {
    const toast = document.createElement('div');
    const icons = { spawn: '🟢', complete: '✅', status: '🔄', error: '🔴' };
    toast.className = `toast ${c.type}`;
    toast.innerHTML = `${icons[c.type] || '📋'} <strong>${c.type}</strong>: ${c.key?.split(':').pop() || '?'}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}

// ── Period Controls ──
function setupPeriodButtons() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period || parseInt(btn.dataset.days);
      syncDateInputs();
      requestData();
    });
  });
  document.getElementById('btnApply').addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    currentPeriod = -1;
    requestData();
  });
}

function syncDateInputs() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dfEl = document.getElementById('dateFrom');
  const dtEl = document.getElementById('dateTo');
  dtEl.value = today;

  if (currentPeriod === 'thisWeek') {
    const day = now.getDay(); const diff = day === 0 ? 6 : day - 1;
    const mon = new Date(now); mon.setDate(now.getDate() - diff);
    dfEl.value = mon.toISOString().split('T')[0];
  } else if (currentPeriod === 'thisMonth') {
    const y = now.getFullYear(), m = now.getMonth() + 1;
    dfEl.value = `${y}-${String(m).padStart(2,'0')}-01`;
  } else if (currentPeriod === 'all' || currentPeriod === 0 || currentPeriod === '0') {
    dfEl.value = ''; dtEl.value = '';
  } else if (typeof currentPeriod === 'number' && currentPeriod > 0) {
    const d = new Date(); d.setDate(d.getDate() - currentPeriod);
    dfEl.value = d.toISOString().split('T')[0];
  }
}

function getDateParams() {
  const params = {};
  if (currentPeriod === -1) {
    const f = document.getElementById('dateFrom').value;
    const t = document.getElementById('dateTo').value;
    if (f) params.from = f; if (t) params.to = t;
  } else if (currentPeriod === 'thisWeek') {
    const now = new Date(); const day = now.getDay(); const diff = day === 0 ? 6 : day - 1;
    const mon = new Date(now); mon.setDate(now.getDate() - diff);
    params.from = mon.toISOString().split('T')[0];
  } else if (currentPeriod === 'thisMonth') {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1;
    params.from = `${y}-${String(m).padStart(2,'0')}-01`;
  } else if (currentPeriod > 0) {
    const d = new Date(); d.setDate(d.getDate() - currentPeriod);
    params.from = d.toISOString().split('T')[0];
  }
  return params;
}

function requestData() {
  if (useWebSocket && socket?.connected) {
    socket.emit('requestSnapshot', getDateParams());
  } else {
    fetchData();
  }
}

async function fetchData() {
  try {
    const params = getDateParams();
    const qs = Object.entries(params).map(([k,v]) => `${k}=${v}`).join('&');
    const url = qs ? `${API_URL}?${qs}` : API_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (data.success) {
      showLoading(false);
      showError(null);
      render(data);
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (e) {
    console.error('Fetch error:', e);
    showLoading(false);
    showError(`Failed to load data: ${e.message}`);
  }
  updateTimestamp();
}

function updateTimestamp() {
  const now = new Date();
  const el = document.getElementById('lastRefresh');
  if (el) el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pl = document.getElementById('periodLabel');
  if (pl) {
    const f = document.getElementById('dateFrom').value;
    const t = document.getElementById('dateTo').value;
    pl.textContent = f && t ? `${f} ~ ${t}` : f ? `${f} ~ now` : 'All';
  }
}

// ── Render ──
function render(data) {
  const c = data.cumulative;
  if (!c) return;
  updateTimestamp();

  const subTotal = c.subscriptionTotal || 0;
  document.getElementById('subTotal').textContent = '$' + subTotal.toFixed(2);
  const parts = [];
  for (const [, d] of Object.entries(c.subscriptionBreakdown || {})) {
    parts.push(`${d.label} $${d.price.toFixed(0)}`);
  }
  document.getElementById('subDetail').textContent = parts.join(' + ') || 'No subscriptions detected';
  document.getElementById('utilDenom').textContent = '$' + subTotal.toFixed(0);
  document.getElementById('apiValue').textContent = '$' + c.totalEstimatedApiCost.toFixed(2);
  document.getElementById('apiValueSub').textContent = `$${c.dailyCost.toFixed(2)}/day · $${c.monthlyCost.toFixed(2)}/mo est.`;
  document.getElementById('totalTokens').textContent = fmtTokens(c.totalTokens);
  document.getElementById('tokenBreakdown').textContent = `in: ${fmtTokens(c.totalInput)} / out: ${fmtTokens(c.totalOutput)} / cache: ${fmtTokens(c.totalCacheRead + c.totalCacheWrite)}`;
  document.getElementById('activeDays').textContent = c.activeDays;
  document.getElementById('dateRangeText').textContent = c.dateRange.start ? c.dateRange.start.split('T')[0] + ' ~ ' + c.dateRange.end.split('T')[0] : '-';

  // Utilization
  const util = c.utilization || 0;
  document.getElementById('utilPct').textContent = util.toFixed(1) + '%';
  const fill = document.getElementById('utilFill');
  fill.style.width = Math.min(util, 150) / 1.5 + '%';
  fill.className = 'util-fill' + (util > 100 ? ' over' : util > 70 ? ' high' : '');

  renderSubscriptionBreakdown(c.subscriptionBreakdown);

  // Sort agents by cost descending
  const agentKeys = Object.keys(c.byAgent).sort((a, b) => (c.byAgent[b].cost || 0) - (c.byAgent[a].cost || 0));
  document.getElementById('agentCount').textContent = agentKeys.length;
  renderAgentGrid(c.byAgent, agentKeys, data.sessions);

  renderStackedBar('costByAgentChart', c.dailyCostByAgent, agentKeys, AGENT_COLORS, '$', true);
  renderStackedBar('costByModelChart', c.dailyCostByModel, extractKeys(c.dailyCostByModel), MODEL_COLORS, '$', true);
  renderStackedBar('tokensByAgentChart', c.dailyTokensByAgent, agentKeys, AGENT_COLORS, 'tok', false);
  renderStackedBar('tokensByModelChart', c.dailyTokensByModel, extractKeys(c.dailyTokensByModel), MODEL_COLORS, 'tok', false);

  renderModelTable(c.byModel);
  renderMatrix(c.agentModelMatrix);
  renderSessions(data.sessions, data.stats);
}

function renderSubscriptionBreakdown(subs) {
  const row = document.getElementById('subRow');
  if (!subs || !Object.keys(subs).length) { row.innerHTML = ''; return; }
  row.innerHTML = Object.entries(subs).map(([, d]) => {
    const cls = d.savings >= 0 ? 'text-green' : 'text-red';
    const lbl = d.savings >= 0 ? `+$${d.savings.toFixed(2)} saved` : `-$${Math.abs(d.savings).toFixed(2)}`;
    return `<div class="sub-card">
      <div class="sub-name">${d.label || 'Subscription'}</div>
      <div class="sub-price">$${d.price.toFixed(2)}/mo</div>
      <div class="sub-detail"><span>API equiv: <strong>$${d.estimatedApiCost.toFixed(2)}</strong></span><span class="${cls}">${lbl}</span></div>
      <div class="sub-util-track"><div class="sub-util-fill ${d.utilization > 100 ? 'over' : ''}" style="width:${Math.min(d.utilization, 100)}%"></div></div>
      <div class="sub-util-pct">${d.utilization.toFixed(1)}%</div>
    </div>`;
  }).join('');
}

function renderAgentGrid(byAgent, keys, sessions) {
  const grid = document.getElementById('agentGrid');
  if (!keys.length) { grid.innerHTML = '<span class="text-muted">No agent data</span>'; return; }

  // Determine live status from sessions
  const activeKeys = new Set();
  if (sessions) {
    if (sessions.main) {
      activeKeys.add('main');
      // Also match agent aliases (e.g. main session key contains agent name)
      for (const k of keys) {
        if (sessions.main.key && sessions.main.key.includes(k)) activeKeys.add(k);
      }
    }
    for (const s of (sessions.subagents || [])) {
      activeKeys.add(s.id);
      // Match agent names from subagent keys (e.g. "agent:main:subagent:xyz")
      const keyParts = (s.key || '').split(':');
      for (const part of keyParts) {
        if (keys.includes(part)) activeKeys.add(part);
      }
    }
  }

  grid.innerHTML = keys.map(name => {
    const d = byAgent[name];
    const status = activeKeys.has(name) ? '🟢' : '⚪';
    const color = getColor(name, AGENT_COLORS);
    return `<div class="agent-item">
      <div class="agent-color" style="background:${color}"></div>
      <div class="status-indicator">${status}</div>
      <div class="name">${name}</div>
      <div class="cost">$${d.cost.toFixed(2)}</div>
      <div class="tokens">${fmtTokens(d.tokens)} tokens</div>
      <div class="model">${shortModel(d.model)}</div>
    </div>`;
  }).join('');
}

// ── Colors ──
const AGENT_COLORS = {};
const MODEL_COLORS = {
  'claude-opus-4-6': '#1e40af', 'claude-opus-4-5': '#1d4ed8', 'claude-opus-4': '#1e3a8a',
  'claude-sonnet-4': '#3b82f6', 'claude-sonnet-4-20250514': '#60a5fa', 'claude-sonnet-4-5-20250929': '#818cf8',
  'claude-haiku-3-5': '#93c5fd',
  'gemini-3-pro-preview': '#15803d', 'gemini-2.5-pro': '#166534', 'gemini-2.5-flash': '#4ade80',
  'gemini-3-flash-preview': '#22c55e',
  'gpt-5.3-codex': '#a16207', 'gpt-4.1': '#ca8a04',
  'grok-4-1-fast': '#dc2626', 'grok-4': '#991b1b',
};
const PALETTE = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1'];

function getColor(name, map) {
  if (map[name]) return map[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function extractKeys(dailyData) {
  if (!dailyData) return [];
  const s = new Set();
  dailyData.forEach(d => Object.keys(d).forEach(k => { if (k !== 'date') s.add(k); }));
  return [...s];
}

// ── Charts ──
function renderStackedBar(canvasId, dailyData, keys, colorMap, unit, isCost) {
  if (!dailyData?.length) return;
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const labels = dailyData.map(d => d.date.substring(5));
  let activeKeys = keys.filter(k => k !== 'date' && dailyData.some(d => (d[k] || 0) > 0));
  activeKeys.sort((a, b) => {
    const sa = dailyData.reduce((s, d) => s + (d[a] || 0), 0);
    const sb = dailyData.reduce((s, d) => s + (d[b] || 0), 0);
    return sb - sa;
  });

  const datasets = activeKeys.map(k => ({
    label: shortModel(k), data: dailyData.map(d => d[k] || 0),
    backgroundColor: getColor(k, colorMap), stack: 'a', yAxisID: 'y', order: 2,
  }));

  // Cumulative line
  const cumData = []; let cum = 0;
  for (const d of dailyData) {
    let t = 0; for (const k of activeKeys) t += (d[k] || 0);
    cum += t; cumData.push(cum);
  }
  datasets.push({
    label: 'Cumulative', data: cumData, type: 'line',
    borderColor: '#6b7280', backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 0, yAxisID: 'y1', order: 1,
  });

  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() || '#1f2937';
  const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6b7280';

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(ctx, {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: mutedColor, filter: i => i.text !== 'Cumulative' } },
        tooltip: { callbacks: { label: c => {
          const v = c.parsed.y;
          if (c.dataset.label === 'Cumulative') return isCost ? `Cum: $${v.toFixed(2)}` : `Cum: ${fmtTokens(v)}`;
          return isCost ? `${c.dataset.label}: $${v.toFixed(2)}` : `${c.dataset.label}: ${fmtTokens(v)}`;
        }}}
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 10 }, color: mutedColor }, grid: { color: gridColor } },
        y: { stacked: true, position: 'left', ticks: { callback: v => isCost ? '$'+v.toFixed(0) : fmtTokens(v), font: { size: 10 }, color: mutedColor }, grid: { color: gridColor } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => isCost ? '$'+v.toFixed(0) : fmtTokens(v), font: { size: 10 }, color: mutedColor } },
      }
    }
  });
}

// ── Tables ──
function renderModelTable(byModel) {
  const tbody = document.querySelector('#modelTable tbody');
  const sorted = Object.entries(byModel).sort((a, b) => b[1].totalCost - a[1].totalCost);
  if (!sorted.length) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No data</td></tr>'; return; }
  const tags = { subscription: '<span class="tag tag-sub">subscription</span>', payperuse: '<span class="tag tag-ppu">pay-per-use</span>', free: '<span class="tag tag-free">free</span>' };
  tbody.innerHTML = sorted.map(([m, d]) => `<tr>
    <td><strong>${shortModel(m)}</strong></td>
    <td class="text-right fw-bold">$${d.totalCost.toFixed(2)}</td>
    <td class="text-right">$${d.monthlyCost.toFixed(2)}</td>
    <td class="text-right">${fmtTokens(d.input)}</td>
    <td class="text-right">${fmtTokens(d.output)}</td>
    <td class="text-right">${fmtTokens(d.cacheRead)} / ${fmtTokens(d.cacheWrite)}</td>
    <td>${tags[d.planType] || tags.free}</td>
    <td class="text-muted">${(d.agents||[]).join(', ')}</td>
  </tr>`).join('');
}

function renderMatrix(matrix) {
  if (!matrix || !Object.keys(matrix).length) return;
  const agents = Object.keys(matrix);
  const allModels = new Set();
  agents.forEach(a => Object.keys(matrix[a]).forEach(m => allModels.add(m)));
  const models = [...allModels].sort();

  document.querySelector('#matrixTable thead tr').innerHTML =
    '<th>Agent</th>' + models.map(m => `<th class="text-right">${shortModel(m)}</th>`).join('') + '<th class="text-right">Total</th>';

  document.querySelector('#matrixTable tbody').innerHTML = agents.map(a => {
    let total = 0;
    const cells = models.map(m => { const v = matrix[a][m] || 0; total += v; return `<td class="text-right">${v > 0 ? '$'+v.toFixed(2) : '-'}</td>`; }).join('');
    return `<tr><td class="fw-bold">${a}</td>${cells}<td class="text-right fw-bold">$${total.toFixed(2)}</td></tr>`;
  }).join('');
}

function renderSessions(sessions, stats) {
  document.getElementById('sessionCount').textContent = stats.total;
  const tbody = document.querySelector('#sessionTable tbody');
  const all = [...(sessions.subagents || []), ...(sessions.cron || [])];
  if (sessions.main) all.unshift(sessions.main);
  all.sort((a, b) => a.ageMs - b.ageMs);
  if (!all.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No active sessions</td></tr>'; return; }
  tbody.innerHTML = all.map(s => `<tr>
    <td><span class="status-dot ${s.status}"></span>${s.status}</td>
    <td><code>${s.key || s.id}</code></td>
    <td><span class="tag">${shortModel(s.model)}</span></td>
    <td class="text-right">${fmtAge(s.ageMs)}</td>
    <td class="text-right">${fmtTokens(s.tokens)}</td>
  </tr>`).join('');
}

// ── Helpers ──
function fmtTokens(n) { if (!n) return '0'; if (n < 1000) return n.toString(); if (n < 1e6) return (n/1e3).toFixed(1)+'K'; return (n/1e6).toFixed(2)+'M'; }
function fmtAge(ms) { const s = Math.floor(ms/1000); if (s<60) return s+'s'; if (s<3600) return Math.floor(s/60)+'m'; if (s<86400) return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d'; }
// ── Subscription Catalog ──
window.KNOWN_SUBS = {
  claude_max: { price: 100, label: 'Claude Max' },
  claude_max_5x: { price: 200, label: 'Claude Max (5x)' },
  chatgpt_pro: { price: 200, label: 'ChatGPT Pro' },
  chatgpt_plus: { price: 20, label: 'ChatGPT Plus' },
  google_ai_pro: { price: 19.99, label: 'Google AI Pro' },
  google_ai_ultra: { price: 249.99, label: 'Google AI Ultra' },
};

// ── Subscription Management ──
function setupSubscriptionMgmt() {
  loadSubscriptions();
  const select = document.getElementById('subAddSelect');
  const customFields = document.getElementById('subCustomFields');
  select.addEventListener('change', () => {
    customFields.classList.toggle('visible', select.value === 'custom');
  });
  document.getElementById('subAddBtn').addEventListener('click', addSubscription);
}

async function loadSubscriptions() {
  try {
    const res = await fetch(`${BASE_PATH}/api/config`);
    const data = await res.json();
    if (data.success) renderSubMgmtList(data.subscriptions || {});
  } catch { /* silent */ }
}

function renderSubMgmtList(subs) {
  const list = document.getElementById('subMgmtList');
  const entries = Object.entries(subs);
  if (!entries.length) { list.innerHTML = '<span class="text-muted">No subscriptions configured</span>'; return; }
  list.innerHTML = entries.map(([key, sub]) => `<div class="sub-mgmt-item">
    <div class="sub-info"><span class="sub-label">${sub.label || key}</span><span class="sub-price">$${(sub.price||0).toFixed(2)}/mo</span></div>
    <button class="btn-danger" onclick="removeSubscription('${key}')">Remove</button>
  </div>`).join('');
}

async function addSubscription() {
  const select = document.getElementById('subAddSelect');
  const val = select.value;
  if (!val) return;

  let key, sub;
  if (val === 'custom') {
    key = document.getElementById('subCustomKey').value.trim();
    const label = document.getElementById('subCustomLabel').value.trim();
    const price = parseFloat(document.getElementById('subCustomPrice').value);
    if (!key || !label || isNaN(price)) return alert('Fill in all custom fields');
    sub = { price, label };
  } else {
    key = val;
    sub = window.KNOWN_SUBS[val];
    if (!sub) return;
  }

  try {
    const cfgRes = await fetch(`${BASE_PATH}/api/config`);
    const cfgData = await cfgRes.json();
    const subs = cfgData.subscriptions || {};
    subs[key] = sub;
    await saveSubscriptions(subs);
    select.value = '';
    document.getElementById('subCustomFields').classList.remove('visible');
  } catch (e) { alert('Failed: ' + e.message); }
}

async function removeSubscription(key) {
  try {
    const cfgRes = await fetch(`${BASE_PATH}/api/config`);
    const cfgData = await cfgRes.json();
    const subs = cfgData.subscriptions || {};
    delete subs[key];
    await saveSubscriptions(subs);
  } catch (e) { alert('Failed: ' + e.message); }
}

async function saveSubscriptions(subs) {
  const res = await fetch(`${BASE_PATH}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptions: subs }),
  });
  const data = await res.json();
  if (data.success) {
    renderSubMgmtList(subs);
    fetchData(); // refresh dashboard
  } else {
    alert('Save failed: ' + (data.error || 'unknown'));
  }
}

function shortModel(m) {
  if (!m) return '?';
  return m.replace('claude-','').replace('opus-4-6','opus4.6').replace('opus-4-5','opus4.5')
    .replace('sonnet-4-5-20250929','sonnet4.5').replace('sonnet-4-20250514','sonnet4').replace('sonnet-4','sonnet4')
    .replace('haiku-3-5','haiku3.5').replace('gemini-3-pro-preview','gemini3-pro')
    .replace('gemini-2.5-flash-preview-05-20','gemini2.5-flash').replace('gemini-2.5-flash','gemini2.5-flash')
    .replace('gemini-2.5-pro','gemini2.5-pro').replace('gemini-3-flash-preview','gemini3-flash')
    .replace('gpt-5.3-codex','codex5.3').replace('grok-4-1-fast','grok-fast');
}
