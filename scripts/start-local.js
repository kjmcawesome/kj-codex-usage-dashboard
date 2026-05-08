import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { startRefreshHelper } from "../refresh-helper.js";

const refreshHelperUrl = `http://${process.env.REFRESH_HELPER_HOST || "127.0.0.1"}:${process.env.REFRESH_HELPER_PORT || "3185"}`;
const redirectPort = Number(process.env.PORT || 3184);
const publicDashboardUrl = process.env.PUBLIC_DASHBOARD_URL || "https://kjmcawesome.github.io/kj-codex-usage-dashboard/";

function closeServer(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!server || typeof server.close !== "function") {
      resolvePromise();
      return;
    }

    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
}

export async function isHealthyRefreshHelper(helperUrl = refreshHelperUrl) {
  try {
    const response = await fetch(new URL("/status", helperUrl), {
      cache: "no-store"
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

export async function ensureRefreshHelper({
  helperUrl = refreshHelperUrl,
  startHelper = startRefreshHelper
} = {}) {
  if (await isHealthyRefreshHelper(helperUrl)) {
    console.log(`Using existing refresh helper on ${helperUrl}`);
    return {
      server: null,
      reused: true,
      url: helperUrl
    };
  }

  return {
    server: startHelper(),
    reused: false,
    url: helperUrl
  };
}

export function buildPublicDashboardUrl(requestUrl = "/", baseUrl = publicDashboardUrl) {
  const incomingUrl = new URL(requestUrl, "http://localhost");
  const targetUrl = new URL(baseUrl);
  const normalizedBasePath = targetUrl.pathname.replace(/\/$/, "");
  const normalizedRequestPath = incomingUrl.pathname === "/" || incomingUrl.pathname === "/index.html"
    ? ""
    : incomingUrl.pathname.replace(/\/index\.html$/, "");

  targetUrl.pathname = normalizedRequestPath
    ? `${normalizedBasePath}${normalizedRequestPath}`
    : `${normalizedBasePath}/`;
  targetUrl.search = incomingUrl.search;
  return targetUrl.toString();
}

export function createPublicRedirectServer({
  dashboardUrl = publicDashboardUrl
} = {}) {
  return createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const location = buildPublicDashboardUrl(req.url || "/", dashboardUrl);
    res.writeHead(302, {
      Location: location,
      "Cache-Control": "no-store"
    });
    res.end();
  });
}

export function startPublicRedirectServer({
  portOverride = redirectPort,
  dashboardUrl = publicDashboardUrl
} = {}) {
  const server = createPublicRedirectServer({ dashboardUrl });
  server.listen(portOverride, () => {
    console.log(`KJ Codex Usage Dashboard local shim redirecting on http://localhost:${portOverride}`);
    console.log(`Public dashboard: ${dashboardUrl}`);
  });
  return server;
}

export async function startLocal({
  startHelper = startRefreshHelper,
  helperUrl = refreshHelperUrl,
  startRedirectServer = startPublicRedirectServer
} = {}) {
  const redirectServer = startRedirectServer();
  let refreshHelper = null;

  try {
    refreshHelper = await ensureRefreshHelper({
      helperUrl,
      startHelper
    });
  } catch (error) {
    await closeServer(redirectServer);
    throw error;
  }

  async function shutdown() {
    try {
      await closeServer(refreshHelper.server);
      await closeServer(redirectServer);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    redirectServer,
    refreshHelper
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startLocal();
}
