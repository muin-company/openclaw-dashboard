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
}

/** Load and parse openclaw.json — auto-detect agents, subscriptions */
export function loadConfig(configOverride?: any): OpenClawDashboardConfig {
  let raw: any;
  try {
    raw = configOverride || JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
  } catch {
    return { agents: {}, subscriptions: {}, authProfiles: {}, defaultProvider: 'unknown', defaultModel: 'unknown' };
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

  // Auto-detect subscriptions from auth profiles
  const authProfiles = raw.auth?.profiles || {};
  const subscriptions: Record<string, Subscription> = {};
  for (const [, profile] of Object.entries<any>(authProfiles)) {
    const prov = profile.provider;
    if (prov === 'anthropic') subscriptions['anthropic_max'] = { price: 200.0, label: 'Anthropic Max' };
    if (prov === 'openai-codex' || prov === 'openai') subscriptions['openai_plus'] = { price: 20.0, label: 'OpenAI Plus' };
    if (prov === 'google-gemini-cli' && profile.mode === 'oauth' && profile.plan === 'pro') subscriptions['google_ai_pro'] = { price: 19.99, label: 'Google AI Pro' };
  }

  return { agents, subscriptions, authProfiles, defaultProvider, defaultModel };
}

export function classifyModel(modelName: string, agentId: string, config: OpenClawDashboardConfig): { subKey: string | null; planType: string } {
  if (!modelName || modelName === 'delivery-mirror') return { subKey: null, planType: 'free' };
  const ml = modelName.toLowerCase();

  if (ml.includes('claude')) {
    return config.subscriptions.anthropic_max
      ? { subKey: 'anthropic_max', planType: 'subscription' }
      : { subKey: null, planType: 'payperuse' };
  }
  if (ml.includes('gpt') || ml.includes('codex')) {
    return config.subscriptions.openai_plus
      ? { subKey: 'openai_plus', planType: 'subscription' }
      : { subKey: null, planType: 'payperuse' };
  }
  if (ml.includes('grok')) return { subKey: null, planType: 'payperuse' };
  if (ml.includes('gemini')) {
    if (config.subscriptions.google_ai_pro) {
      return { subKey: 'google_ai_pro', planType: 'subscription' };
    }
    // google-gemini-cli OAuth without pro plan = free
    const agentCfg = config.agents[agentId];
    if (agentCfg?.provider === 'google-gemini-cli') {
      return { subKey: null, planType: 'free' };
    }
    for (const p of Object.values(config.authProfiles)) {
      if ((p as any).provider === 'google-gemini-cli') return { subKey: null, planType: 'free' };
    }
    return { subKey: null, planType: 'payperuse' };
  }
  return { subKey: null, planType: 'free' };
}

export function determineBillingType(ocCost: number, modelName: string, agentId: string, config: OpenClawDashboardConfig): string {
  const { subKey, planType } = classifyModel(modelName, agentId, config);
  if (planType === 'subscription') {
    if (subKey === 'google_ai_pro' && ocCost > 0) return 'payperuse';
    return 'subscription';
  }
  return planType;
}
