import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { exportStaticSite } from "./scripts/export-static-site.js";
import { publishPages } from "./scripts/publish-pages.js";

const port = Number(process.env.REFRESH_HELPER_PORT || 3185);
const host = process.env.REFRESH_HELPER_HOST || "127.0.0.1";
const allowedOriginPatterns = [
  /^https:\/\/kjmcawesome\.github\.io$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/
];

class ForbiddenError extends Error {}

function isAllowedOrigin(origin) {
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value == null) {
    return defaultValue;
  }

  return value !== "0" && value !== "false";
}

function buildCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return {};
  }

  if (!isAllowedOrigin(origin)) {
    throw new ForbiddenError("Origin is not allowed to use the local refresh helper");
  }

  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };

  if (req.headers["access-control-request-private-network"] === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
  }

  return headers;
}

function sendBody(res, method, statusCode, body, headers = {}) {
  const responseHeaders = {
    "Cache-Control": "no-store",
    ...headers
  };
  if (body != null) {
    responseHeaders["Content-Length"] = Buffer.byteLength(body);
  }
  res.writeHead(statusCode, responseHeaders);
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function sendJson(res, method, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  sendBody(res, method, statusCode, body, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
}

function sanitizeRefreshResult(result, publish) {
  return {
    generated_at: result.generated_at,
    session_count: result.session_count,
    workspace_count: result.workspace_count,
    published: publish,
    pushed: result.pushed ?? false,
    branch: result.branch ?? null
  };
}

function normalizeBridgeReturnTo(value) {
  if (!value) {
    return "https://kjmcawesome.github.io/kj-codex-usage-dashboard/";
  }

  try {
    const parsed = new URL(value);
    if (isAllowedOrigin(parsed.origin)) {
      return parsed.toString();
    }
  } catch {
    // Fall through to the public dashboard URL.
  }

  return "https://kjmcawesome.github.io/kj-codex-usage-dashboard/";
}

function renderBridgePage(returnTo) {
  const safeReturnTo = JSON.stringify(returnTo);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>KJ Codex Usage Dashboard Refresh</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Avenir Next", "SF Pro Text", "Segoe UI", sans-serif;
        background: #f6f3eb;
        color: #233127;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(122, 173, 129, 0.18), transparent 28%),
          linear-gradient(180deg, #faf7ef 0%, #f3f0e8 45%, #ece7dc 100%);
      }
      main {
        width: min(520px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 24px;
        background: rgba(255, 252, 245, 0.94);
        border: 1px solid rgba(35, 49, 39, 0.1);
        box-shadow: 0 18px 40px rgba(35, 49, 39, 0.12);
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #63705e;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 1.6rem;
        letter-spacing: -0.03em;
      }
      #status {
        margin-top: 18px;
        font-weight: 700;
        color: #284836;
      }
      #detail {
        margin-top: 10px;
      }
      a {
        color: #284836;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Force rebuilding the snapshot</h1>
      <p>This tab is using the local refresh helper on your machine to rebuild from <code>~/.codex</code> and publish a fresh snapshot.</p>
      <p id="status">Starting local rebuild...</p>
      <p id="detail"></p>
    </main>
    <script>
      const returnTo = ${safeReturnTo};
      const statusNode = document.querySelector("#status");
      const detailNode = document.querySelector("#detail");

      function buildReturnUrl() {
        const nextUrl = new URL(returnTo);
        nextUrl.searchParams.set("refresh_ts", String(Date.now()));
        return nextUrl.toString();
      }

      async function run() {
        try {
          const response = await fetch("/refresh", {
            method: "POST",
            cache: "no-store"
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.detail || payload.error || "Refresh helper failed");
          }

          const payload = await response.json();
          statusNode.textContent = payload.pushed
            ? "Local rebuild complete. Returning to the dashboard..."
            : "Local rebuild complete. Reloading the dashboard...";
          detailNode.textContent = payload.generated_at
            ? "New snapshot generated at " + new Date(payload.generated_at).toLocaleString()
            : "";

          const nextUrl = buildReturnUrl();
          window.setTimeout(() => {
            if (window.opener && !window.opener.closed) {
              window.opener.location = nextUrl;
              window.close();
              return;
            }

            window.location.assign(nextUrl);
          }, payload.pushed ? 2500 : 1000);
        } catch (error) {
          statusNode.textContent = error instanceof Error ? error.message : String(error);
          detailNode.innerHTML = 'The helper is local-only. If this machine should be able to rebuild, make sure the refresh helper is running on <code>127.0.0.1:3185</code>.';
        }
      }

      run();
    </script>
  </body>
</html>
`;
}

export function createRefreshHelperServer({
  refreshFn = async ({ publish }) => {
    if (publish) {
      return publishPages();
    }

    return exportStaticSite();
  }
} = {}) {
  let currentRefreshPromise = null;
  let lastResult = null;

  async function runRefresh({ publish }) {
    if (!currentRefreshPromise) {
      currentRefreshPromise = (async () => {
        const result = await refreshFn({ publish });
        lastResult = sanitizeRefreshResult(result, publish);
        return lastResult;
      })().finally(() => {
        currentRefreshPromise = null;
      });
    }

    return currentRefreshPromise;
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const corsHeaders = buildCorsHeaders(req);
      const isReadMethod = req.method === "GET" || req.method === "HEAD";

      if (req.method === "OPTIONS") {
        sendBody(res, req.method, 204, null, corsHeaders);
        return;
      }

      if (isReadMethod && url.pathname === "/status") {
        sendJson(res, req.method, 200, {
          ok: true,
          busy: Boolean(currentRefreshPromise),
          last_result: lastResult
        }, corsHeaders);
        return;
      }

      if (isReadMethod && url.pathname === "/bridge") {
        sendBody(
          res,
          req.method,
          200,
          renderBridgePage(normalizeBridgeReturnTo(url.searchParams.get("return_to"))),
          {
            "Content-Type": "text/html; charset=utf-8"
          }
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/refresh") {
        const publish = parseBooleanFlag(url.searchParams.get("publish"), true);
        const result = await runRefresh({ publish });
        sendJson(res, req.method, 200, {
          ok: true,
          busy: false,
          ...result
        }, corsHeaders);
        return;
      }

      sendJson(res, req.method || "GET", 404, {
        error: "Not found"
      }, corsHeaders);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        sendJson(res, req.method || "GET", 403, {
          error: "Forbidden",
          detail: error.message
        });
        return;
      }

      sendJson(res, req.method || "GET", 500, {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

export function startRefreshHelper({
  portOverride = port,
  hostOverride = host
} = {}) {
  const server = createRefreshHelperServer();
  server.listen(portOverride, hostOverride, () => {
    console.log(`KJ Codex Usage Dashboard refresh helper listening on http://${hostOverride}:${portOverride}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startRefreshHelper();
}
