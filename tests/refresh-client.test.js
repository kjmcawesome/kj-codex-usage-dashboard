import test from "node:test";
import assert from "node:assert/strict";
import { loadPublishedSnapshot, refreshUsage, validateSnapshot } from "../public/refresh-client.js";

const date = "2026-08-26T20:00:00Z";
const sample = (generated_at = date) => ({ counting_version: 3, snapshot_version: 3, generated_at, sessions: [] });
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

test("Refresh recounts once and loads that new snapshot, without waiting for a stale CDN", async () => {
  const calls = [];
  const progress = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, method: options.method, cache: options.cache });
    if (url.includes("/status")) return response({ ok: true, counting_version: 3 });
    if (url.includes("/refresh")) return response({ ok: true, generated_at: date, published: true });
    if (url.includes("/snapshot?")) return response(sample());
    throw new Error("Should not use old published data after a recount");
  };
  const result = await refreshUsage({ fetchFn, publish: true, now: () => 123, onProgress: (message) => progress.push(message) });
  assert.equal(result.rebuilt, true);
  assert.equal(result.source, "collector");
  assert.equal(result.snapshot.generated_at, date);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.match(calls[1].url, /publish=1/);
  assert.ok(calls.every((call) => call.cache === "no-store"));
  assert.equal(progress.length, 2);
});

test("Hosted viewers without a collector get a clearly labeled published-data check", async () => {
  const calls = [];
  const result = await refreshUsage({ fetchFn: async (url) => {
    calls.push(url);
    if (url.includes("/status")) throw new Error("Local connection blocked");
    return response(sample());
  } });
  assert.equal(result.rebuilt, false);
  assert.equal(result.published, false);
  assert.equal(result.source, "published");
  assert.match(result.message, /no new logs were collected/);
  assert.equal(calls.length, 2);
});

test("Publish/recount failure is not hidden by a stale fallback or a duplicate recount", async () => {
  const calls = [];
  await assert.rejects(refreshUsage({ fetchFn: async (url) => {
    calls.push(url);
    if (url.includes("/status")) return response({ ok: true, counting_version: 3 });
    return response({ error: "Failed" }, 500);
  } }), /500/);
  assert.equal(calls.filter((url) => url.includes("/refresh")).length, 1);
  assert.equal(calls.length, 2);
});

test("A local-only recount does not claim the shared website was published", async () => {
  const result = await refreshUsage({ publish: false, fetchFn: async (url) => {
    if (url.includes("/status")) return response({ ok: true, counting_version: 3 });
    if (url.includes("/refresh")) { assert.match(url, /publish=0/); return response({ ok: true, generated_at: date, published: false }); }
    return response(sample());
  } });
  assert.equal(result.rebuilt, true);
  assert.equal(result.published, false);
  assert.match(result.message, /not a new shared-site snapshot/);
});

test("Outdated collectors are rejected before they can overwrite the corrected snapshot", async () => {
  const calls = [];
  await assert.rejects(refreshUsage({ fetchFn: async (url) => {
    calls.push(url); return response({ ok: true });
  } }), /collector needs the counting update/);
  assert.equal(calls.length, 1);
});

test("A collector returning the wrong generation is rejected", async () => {
  await assert.rejects(refreshUsage({ fetchFn: async (url) => {
    if (url.includes("/status")) return response({ ok: true, counting_version: 3 });
    if (url.includes("/refresh")) return response({ ok: true, generated_at: date });
    return response(sample("2026-08-20T20:00:00Z"));
  } }), /older snapshot/);
});

test("A published refresh never downgrades a newer locally collected view", async () => {
  await assert.rejects(refreshUsage({ minimumGeneratedAt: date, fetchFn: async (url) => {
    if (url.includes("/status")) throw new Error("Offline");
    return response(sample("2026-08-20T20:00:00Z"));
  } }), /older than the data on screen/);
});

test("Initial loading bypasses the cache and validates the counting schema", async () => {
  const loaded = await loadPublishedSnapshot({ now: () => 99, fetchFn: async (url, options) => {
    assert.match(url, /\?t=99$/); assert.equal(options.cache, "no-store"); return response(sample());
  } });
  assert.equal(loaded.counting_version, 3);
  assert.throws(() => validateSnapshot({ generated_at: date, sessions: [] }), /corrected counting update/);
});
