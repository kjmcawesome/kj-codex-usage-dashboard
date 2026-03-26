import test from "node:test";
import assert from "node:assert/strict";

import { createRefreshHelperServer } from "../refresh-helper.js";

async function withRefreshHelper(callback) {
  const calls = [];
  const server = createRefreshHelperServer({
    refreshFn: async ({ publish }) => {
      calls.push({ publish });
      return {
        generated_at: "2026-03-26T22:00:00.000Z",
        session_count: 9,
        workspace_count: 3,
        pushed: publish,
        branch: publish ? "gh-pages" : null
      };
    }
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await callback({ baseUrl, calls });
  } finally {
    await new Promise((resolvePromise, rejectPromise) =>
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
    );
  }
}

test("refresh helper exposes status with allowed CORS origin", async () => {
  await withRefreshHelper(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/status`, {
      headers: {
        Origin: "https://kjmcawesome.github.io"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://kjmcawesome.github.io");
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.busy, false);
    assert.equal(payload.last_result, null);
  });
});

test("refresh helper handles private network preflight", async () => {
  await withRefreshHelper(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/refresh`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://kjmcawesome.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Private-Network": "true"
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://kjmcawesome.github.io");
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
  });
});

test("refresh helper serves a localhost bridge page for public-site refreshes", async () => {
  await withRefreshHelper(async ({ baseUrl }) => {
    const response = await fetch(
      `${baseUrl}/bridge?return_to=${encodeURIComponent("https://kjmcawesome.github.io/kj-codex-usage-dashboard/?days=365")}`
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const html = await response.text();
    assert.match(html, /Force rebuilding the snapshot/);
    assert.match(html, /https:\/\/kjmcawesome\.github\.io\/kjmcawesome\.github\.io|kj-codex-usage-dashboard/);
  });
});

test("refresh helper runs a published rebuild", async () => {
  await withRefreshHelper(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/refresh`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3184"
      }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.published, true);
    assert.equal(payload.pushed, true);
    assert.equal(payload.branch, "gh-pages");
    assert.deepEqual(calls, [{ publish: true }]);
  });
});

test("refresh helper rejects disallowed origins", async () => {
  await withRefreshHelper(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/status`, {
      headers: {
        Origin: "https://example.com"
      }
    });

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.error, "Forbidden");
  });
});
