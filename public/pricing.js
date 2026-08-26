// Standard API token rates, USD per 1M tokens. Checked against the linked source.
export const PRICING = Object.freeze({
  checked_at: "2026-08-26",
  source: "https://developers.openai.com/api/docs/pricing",
  basis: "Current Standard API rates, not historical invoices or Codex plan charges",
  proxy: "gpt-5.6-sol",
  long_context_threshold: 272000
});

const rate = (input, cached, output, write = input, long = false) => Object.freeze({
  input, cached_input: cached ?? input, cache_write: write, output, long_context: long
});

export const RATES = Object.freeze({
  "gpt-5.6-sol": rate(4, 0.4, 20, 5, true),
  "gpt-5.6-terra": rate(2, 0.2, 12, 2.5, true),
  "gpt-5.6-luna": rate(0.2, 0.02, 1.2, 0.25, true),
  "gpt-5.6-cyber": rate(12.5, 1.25, 75, 15.625),
  "gpt-5.5": rate(5, 0.5, 30, 5, true),
  "gpt-5.5-pro": rate(30, null, 180, 30, true),
  "gpt-5.4": rate(2.5, 0.25, 15, 2.5, true),
  "gpt-5.4-pro": rate(30, null, 180, 30, true),
  "gpt-5.4-mini": rate(0.75, 0.075, 4.5),
  "gpt-5.4-nano": rate(0.2, 0.02, 1.25),
  "gpt-5.3-codex": rate(1.75, 0.175, 14),
  "gpt-5.2-codex": rate(1.75, 0.175, 14),
  "gpt-5.2": rate(1.75, 0.175, 14),
  "gpt-5.2-pro": rate(21, null, 168),
  "gpt-5.1": rate(1.25, 0.125, 10),
  "gpt-5": rate(1.25, 0.125, 10),
  "gpt-5-mini": rate(0.25, 0.025, 2),
  "gpt-5-nano": rate(0.05, 0.005, 0.4),
  "gpt-5-pro": rate(15, null, 120),
  "gpt-4.1": rate(2, 0.5, 8),
  "gpt-4.1-mini": rate(0.4, 0.1, 1.6),
  "gpt-4.1-nano": rate(0.1, 0.025, 0.4),
  "gpt-4o": rate(2.5, 1.25, 10),
  "gpt-4o-mini": rate(0.15, 0.075, 0.6),
  "gpt-4o-2024-05-13": rate(5, null, 15),
  o1: rate(15, 7.5, 60),
  "o1-pro": rate(150, null, 600),
  o3: rate(2, 0.5, 8),
  "o3-pro": rate(20, null, 80),
  "o3-mini": rate(1.1, 0.55, 4.4),
  "o4-mini": rate(1.1, 0.275, 4.4),
  "chat-latest": rate(5, 0.5, 30)
});

const ALIASES = Object.freeze({
  arcanine: "gpt-5.5",
  "gpt-5.6": "gpt-5.6-sol",
  sol: "gpt-5.6-sol",
  terra: "gpt-5.6-terra",
  luna: "gpt-5.6-luna",
  "codex-auto-review": "gpt-5.3-codex"
});

export function resolveModel(value, explicitlyProxy = false) {
  const raw = String(value || "").trim().toLowerCase();
  const candidate = ALIASES[raw] || raw;
  const dated = candidate.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const model = RATES[candidate] ? candidate : RATES[dated] ? dated : PRICING.proxy;
  const proxy = explicitlyProxy || (!RATES[candidate] && !RATES[dated]);
  return { model, proxy, label: proxy ? "Unreleased / unknown (Sol estimate)" : model };
}

export function contextBand(event) {
  if (["short", "long", "unknown"].includes(event.pricing_context)) return event.pricing_context;
  return Number.isFinite(event.context_input_tokens)
    ? event.context_input_tokens > PRICING.long_context_threshold ? "long" : "short"
    : "unknown";
}

export function priceEvent(event) {
  const resolved = resolveModel(event.model, Boolean(event.is_proxy));
  const base = RATES[resolved.model];
  const context = contextBand(event);
  const isLong = base.long_context && context === "long";
  const rates = {
    input: base.input * (isLong ? 2 : 1),
    cached_input: base.cached_input * (isLong ? 2 : 1),
    cache_write: base.cache_write * (isLong ? 2 : 1),
    output: base.output * (isLong ? 1.5 : 1)
  };
  const input = Math.max(0, event.input_tokens || 0);
  const cached = Math.min(input, Math.max(0, event.cached_input_tokens || 0));
  const writes = Math.min(input - cached, Math.max(0, event.cache_write_input_tokens || 0));
  const fresh = input - cached - writes;
  // Cached reads and writes are subsets of input; reasoning is already in output.
  const components = {
    input: fresh * rates.input / 1e6,
    cached_input: cached * rates.cached_input / 1e6,
    cache_write: writes * rates.cache_write / 1e6,
    output: Math.max(0, event.output_tokens || 0) * rates.output / 1e6
  };
  return {
    ...event,
    priced_model: resolved.model,
    model_label: resolved.label,
    is_proxy: resolved.proxy,
    pricing_context: context,
    rates,
    fresh_input_tokens: fresh,
    estimated_cost_usd: Object.values(components).reduce((sum, value) => sum + value, 0),
    cost_components: components,
    proxy_tokens: resolved.proxy ? event.total_tokens || 0 : 0,
    unallocated_tokens: Math.max(0, (event.total_tokens || 0) - input - (event.output_tokens || 0)),
    unknown_context_tokens: base.long_context && context === "unknown" ? event.total_tokens || 0 : 0
  };
}
