/** API pricing per million tokens (synced from LiteLLM 2026-02-16) */
export const PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  // Anthropic
  'claude-opus-4-6':   { input: 5.0,  output: 25.0, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-5':   { input: 5.0,  output: 25.0, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4':     { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4-1':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-4':   { input: 3.0,  output: 15.0, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5-20250929': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-haiku-3-5':  { input: 0.8,  output: 4.0,  cacheRead: 0.08, cacheWrite: 1.0 },
  // xAI
  'grok-4-1-fast': { input: 0.20, output: 0.50, cacheRead: 0.05 },
  'grok-4':        { input: 3.0,  output: 15.0 },
  'grok-2':        { input: 2.0,  output: 10.0 },
  // OpenAI
  'gpt-5.3-codex': { input: 2.0, output: 8.0, cacheRead: 0.5 },
  'gpt-4.1':       { input: 2.0, output: 8.0, cacheRead: 0.5 },
  'gpt-4o':        { input: 2.5, output: 10.0, cacheRead: 1.25 },
  // Google Gemini
  'gemini-3-pro-preview':          { input: 1.25, output: 10.0,  cacheRead: 0.125 },
  'gemini-2.5-pro':                { input: 1.25, output: 10.0,  cacheRead: 0.125 },
  'gemini-2.5-flash':              { input: 0.30, output: 2.50,  cacheRead: 0.03 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.30, output: 2.50,  cacheRead: 0.03 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.0,   cacheRead: 0.05 },
  // Default
  'default': { input: 3.0, output: 15.0 },
};

export function getPricing(modelName?: string) {
  if (!modelName) return PRICING['default'];
  const ml = modelName.toLowerCase();
  if (PRICING[ml]) return PRICING[ml];
  for (const key of Object.keys(PRICING)) {
    if (ml.includes(key)) return PRICING[key];
  }
  if (ml.includes('opus'))   return PRICING['claude-opus-4-6'];
  if (ml.includes('sonnet')) return PRICING['claude-sonnet-4'];
  if (ml.includes('haiku'))  return PRICING['claude-haiku-3-5'];
  if (ml.includes('grok'))   return PRICING['grok-4-1-fast'];
  if (ml.includes('gemini')) return PRICING['gemini-3-pro-preview'];
  if (ml.includes('codex') || ml.includes('gpt')) return PRICING['gpt-5.3-codex'];
  return PRICING['default'];
}
