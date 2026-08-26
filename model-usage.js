import { TOTAL_FIELDS } from "./analytics.js";

const names = {
  "gpt-5.6-sol": "Sol",
  "gpt-5.6-terra": "Terra",
  "gpt-5.6-luna": "Luna"
};

export function modelDisplayName(model) {
  return model.is_proxy ? "Unreleased" : names[model.model] || model.model.replace(/^gpt-/, "GPT-").replace(/-codex/g, " Codex");
}

export function summarizeModelUsage(models) {
  const groups = new Map();
  let totalTokens = 0;
  let totalCost = 0;
  for (const model of models) {
    // Combine context tiers, but never present proxy-priced usage as confirmed Sol usage.
    const id = `${model.model}|${Boolean(model.is_proxy)}`;
    if (!groups.has(id)) groups.set(id, {
      id, model: model.model, is_proxy: Boolean(model.is_proxy), variants: [],
      name: modelDisplayName(model),
      ...Object.fromEntries(TOTAL_FIELDS.map((field) => [field, 0]))
    });
    const group = groups.get(id);
    for (const field of TOTAL_FIELDS) group[field] += model[field] || 0;
    group.variants.push(model);
    totalTokens += model.total_tokens || 0;
    totalCost += model.estimated_cost_usd || 0;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    token_share: totalTokens ? group.total_tokens / totalTokens : 0,
    cost_share: totalCost ? group.estimated_cost_usd / totalCost : 0
  })).sort((a, b) => b.total_tokens - a.total_tokens || b.estimated_cost_usd - a.estimated_cost_usd || a.name.localeCompare(b.name));
}
