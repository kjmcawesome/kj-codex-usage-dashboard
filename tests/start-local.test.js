import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  ensureRefreshHelper,
  isHealthyRefreshHelper
} from "../scripts/start-local.js";

async function withStatusServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await callback({ baseUrl });
  } finally {
    await new Promise((resolvePromise, rejectPromise) =>
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
    );
  }
}

test("isHealthyRefreshHelper returns true for a healthy helper status endpoint", async () => {
  await withStatusServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy: false, last_result: null }));
      return;
    }

    res.writeHead(404);
    res.end();
  }, async ({ baseUrl }) => {
    assert.equal(await isHealthyRefreshHelper(baseUrl), true);
  });
});

test("ensureRefreshHelper reuses an existing healthy helper", async () => {
  await withStatusServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy: false, last_result: null }));
      return;
    }

    res.writeHead(404);
    res.end();
  }, async ({ baseUrl }) => {
    let startCalls = 0;

    const result = await ensureRefreshHelper({
      helperUrl: baseUrl,
      startHelper: () => {
        startCalls += 1;
        return { close() {} };
      }
    });

    assert.equal(startCalls, 0);
    assert.equal(result.reused, true);
    assert.equal(result.server, null);
    assert.equal(result.url, baseUrl);
  });
});

test("ensureRefreshHelper starts a local helper when no healthy helper is already running", async () => {
  let startCalls = 0;
  const fakeServer = { close(callback) { callback?.(); } };

  const result = await ensureRefreshHelper({
    helperUrl: "http://127.0.0.1:9",
    startHelper: () => {
      startCalls += 1;
      return fakeServer;
    }
  });

  assert.equal(startCalls, 1);
  assert.equal(result.reused, false);
  assert.equal(result.server, fakeServer);
});
