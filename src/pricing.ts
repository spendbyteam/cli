/**
 * Anthropic API list prices in USD per million tokens, used by `report` to put a price on local
 * Claude Code usage. Cache writes cost 1.25x input (5-minute TTL) or 2x input (1-hour TTL);
 * cache reads use `cacheRead` when the model has a published rate, otherwise 0.1x input.
 * Prices as of November 2026 (first-party API, standard speed).
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

/** Longest prefix wins, so `claude-opus-5-5` is matched before `claude-opus-5`. */
const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
};

/** Claude Haiku 5.5 bills prompts above 100K tokens at a higher rate. */
const HAIKU_5_5_LONG: ModelPrice = { input: 0.5, output: 2.5 };
const HAIKU_5_5_LONG_AFTER = 100_000;

/** Fast mode bills 2x the standard rate (Opus 5.5: $8 / $40). */
const FAST_MULTIPLIER = 2;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

/** `us.anthropic.claude-opus-4-8-v1:0`, `claude-sonnet-4-5@20250929`, `claude-opus-4-1-20250805` → canonical id. */
export function normalizeModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\[.*?\]$/, '')
    .replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '')
    .replace(/@.*$/, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/-\d{8}$/, '');
}

export function priceFor(model: string): ModelPrice | undefined {
  const id = normalizeModel(model);
  let best: string | undefined;
  for (const key of Object.keys(PRICES)) {
    if ((id === key || id.startsWith(`${key}-`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : undefined;
}

/** Cost in USD of one API response, or undefined when the model has no known price. */
export function costOf(model: string, usage: Usage): number | undefined {
  let price = priceFor(model);
  if (!price) return undefined;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = usage.cache_creation ? (usage.cache_creation.ephemeral_5m_input_tokens ?? 0) : cacheWrite;

  if (normalizeModel(model).startsWith('claude-haiku-5-5') && input + cacheRead + cacheWrite > HAIKU_5_5_LONG_AFTER) {
    price = HAIKU_5_5_LONG;
  }
  const readRate = price.cacheRead ?? price.input * 0.1;
  const dollars =
    (input * price.input + output * price.output + cacheRead * readRate + write5m * price.input * 1.25 + write1h * price.input * 2) /
    1_000_000;
  return usage.speed === 'fast' ? dollars * FAST_MULTIPLIER : dollars;
}
