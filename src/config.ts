import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const OPENCLAW_BASE = path.join(os.homedir(), '.openclaw', 'agents');
export const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

export interface AgentConfig {
  model: string;
  provider: string;
}

export interface Subscription {
  price: number;
  label: string;
}

export interface OpenClawDashboardConfig {
  agents: Record<string, AgentConfig>;
  subscriptions: Record<string, Subscription>;
  authProfiles: Record<string, any>;
  defaultProvider: string;
  defaultModel: string;
  pluginConfig: Record<string, any>;
  unconfiguredProviders: string[];
}

/** Load and parse openclaw.json — auto-detect agents, subscriptions */
export function loadConfig(configOverride?: any): OpenClawDashboardConfig {
  let raw: any;
  try {
    raw = configOverride || JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
  } catch {
    return { agents: {}, subscriptions: {}, authProfiles: {}, defaultProvider: 'unknown', defaultModel: 'unknown', pluginConfig: {}, unconfiguredProviders: [] };
  }

  const defaults = raw.agents?.defaults || {};
  const defaultModelCfg = defaults.model || {};
  const defaultFullModel = typeof defaultModelCfg === 'string' ? defaultModelCfg : (defaultModelCfg.primary || '');
  const [defaultProvider, defaultModel] = defaultFullModel.includes('/')
    ? defaultFullModel.split('/', 2) : ['unknown', defaultFullModel];

  const agents: Record<string, AgentConfig> = {};
  for (const agent of (raw.agents?.list || [])) {
    const id = agent.id;
    if (!id) continue;
    let fullModel = agent.model || '';
    if (typeof fullModel === 'object') fullModel = fullModel.primary || '';
    if (fullModel && fullModel.includes('/')) {
      const [p, m] = fullModel.split('/', 2);
      agents[id] = { model: m, provider: p };
    } else if (fullModel) {
      agents[id] = { model: fullModel, provider: 'unknown' };
    } else {
      agents[id] = { model: defaultModel, provider: defaultProvider };
    }
  }

  // Subscription detection: plugin config overrides > auto-detect from auth profiles
  const authProfiles = raw.auth?.profiles || {};
  const pluginConfig = raw.plugins?.entries?.['openclaw-dashboard']?.config || {};
  const subscriptions: Record<string, Subscription> = {};

  // Known subscription catalog
  const KNOWN_SUBSCRIPTIONS: Record<string, Subscription> = {
    'claude_max': { price: 100.0, label: 'Claude Max' },
    'claude_max_5x': { price: 200.0, label: 'Claude Max (5x)' },
    'chatgpt_pro': { price: 200.0, label: 'ChatGPT Pro' },
    'chatgpt_plus': { price: 20.0, label: 'ChatGPT Plus' },
    'google_ai_pro': { price: 19.99, label: 'Google AI Pro' },
    'google_ai_ultra': { price: 249.99, label: 'Google AI Ultra' },
  };

  // If user configured subscriptions explicitly, use those
  if (pluginConfig.subscriptions && Object.keys(pluginConfig.subscriptions).length > 0) {
    for (const [key, sub] of Object.entries<any>(pluginConfig.subscriptions)) {
      if (KNOWN_SUBSCRIPTIONS[key]) {
        subscriptions[key] = { ...KNOWN_SUBSCRIPTIONS[key], ...sub };
      } else {
        subscriptions[key] = sub;
      }
    }
  }

  // Detect providers in use but not configured
  const detectedProviders: string[] = [];
  for (const [, profile] of Object.entries<any>(authProfiles)) {
    const prov = profile.provider;
    if (prov === 'anthropic' && !subscriptions['claude_max'] && !subscriptions['claude_max_5x']) detectedProviders.push('Anthropic (Claude)');
    if ((prov === 'openai-codex' || prov === 'openai') && !subscriptions['chatgpt_pro'] && !subscriptions['chatgpt_plus']) detectedProviders.push('OpenAI (ChatGPT)');
    if (prov === 'google-gemini-cli' && !subscriptions['google_ai_pro'] && !subscriptions['google_ai_ultra']) detectedProviders.push('Google (Gemini)');
  }

  return { agents, subscriptions, authProfiles, defaultProvider, defaultModel, pluginConfig, unconfiguredProviders: detectedProviders };
}

export function classifyModel(modelName: string, agentId: string, config: OpenClawDashboardConfig): { subKey: string | null; planType: string } {
  if (!modelName || modelName === 'delivery-mirror') return { subKey: null, planType: 'free' };
  const ml = modelName.toLowerCase();

  // Find matching subscription by model type
  const claudeSub = Object.keys(config.subscriptions).find(k => k.startsWith('claude'));
  const openaiSub = Object.keys(config.subscriptions).find(k => k.startsWith('chatgpt') || k.startsWith('openai'));
  const geminiSub = Object.keys(config.subscriptions).find(k => k.startsWith('google'));

  if (ml.includes('claude')) {
    return claudeSub
      ? { subKey: claudeSub, planType: 'subscription' }
      : { subKey: null, planType: 'payperuse' };
  }
  if (ml.includes('gpt') || ml.includes('codex')) {
    return openaiSub
      ? { subKey: openaiSub, planType: 'subscription' }
      : { subKey: null, planType: 'payperuse' };
  }
  if (ml.includes('grok')) return { subKey: null, planType: 'payperuse' };
  if (ml.includes('gemini')) {
    return geminiSub
      ? { subKey: geminiSub, planType: 'subscription' }
      : { subKey: null, planType: 'payperuse' };
  }
  return { subKey: null, planType: 'free' };
}

export function determineBillingType(ocCost: number, modelName: string, agentId: string, config: OpenClawDashboardConfig): string {
  const { subKey, planType } = classifyModel(modelName, agentId, config);
  if (planType === 'subscription') {
    if (subKey?.startsWith('google') && ocCost > 0) return 'payperuse';
    return 'subscription';
  }
  return planType;
}
