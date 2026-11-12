// Numbers are lifetime-to-date USD assumptions for one project in this browser.
export function modelReturn(recorded, inputs) {
  const values = {};
  for (const key of ['hours', 'rate', 'benefit', 'cost']) {
    const raw = inputs[key];
    values[key] = raw == null || raw === '' ? null : Number(raw);
    if (values[key] !== null && (!Number.isFinite(values[key]) || values[key] < 0)) return {error:'Use a positive amount or zero.'};
  }
  const {hours, rate, benefit, cost} = values;
  const investment = recorded.estimated_cost_usd + (cost ?? 0);
  const breakEvenHours = rate > 0 ? Math.max(0, investment - (benefit ?? 0)) / rate : null;
  const hasBenefit = (hours !== null || benefit !== null) && (!(hours > 0) || rate !== null);
  const value = hasBenefit ? (hours ?? 0) * (rate ?? 0) + (benefit ?? 0) : null;
  const net = value === null ? null : value - investment;
  const partial = recorded.unallocated_tokens > 0;
  const roi = investment > 0 && net !== null && !partial ? net / investment : null;
  if (![investment,breakEvenHours,value,net,roi].every(n => n === null || Number.isFinite(n))) return {error:'These amounts are too large to calculate.'};
  return {investment, breakEvenHours:partial ? null : breakEvenHours, value, net:partial ? null : net, roi, partial};
}

export function loadScenario(id) {
  try { return JSON.parse(localStorage.getItem('usage-roi-v1/' + id)) || {}; }
  catch { return {}; }
}

export function saveScenario(id, inputs) {
  try {
    const key = 'usage-roi-v1/' + id;
    if (Object.values(inputs).some(v => v !== '')) localStorage.setItem(key,JSON.stringify(inputs));
    else localStorage.removeItem(key);
    return true;
  } catch { return false; }
}
