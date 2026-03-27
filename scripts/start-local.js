import { fileURLToPath } from "node:url";

import { exportStaticSite } from "./export-static-site.js";
import { startServer } from "../server.js";
import { startRefreshHelper } from "../refresh-helper.js";

const refreshHelperUrl = `http://${process.env.REFRESH_HELPER_HOST || "127.0.0.1"}:${process.env.REFRESH_HELPER_PORT || "3185"}`;

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

export async function startLocal({
  exportFn = exportStaticSite,
  startDashboardServer = startServer,
  startHelper = startRefreshHelper,
  helperUrl = refreshHelperUrl
} = {}) {
  const result = await exportFn();
  console.log(`Exported usage snapshot at ${result.generated_at}`);
  console.log(`Sessions: ${result.session_count}`);
  console.log(`Workspaces: ${result.workspace_count}`);

  const dashboardServer = startDashboardServer();
  let refreshHelper = null;

  try {
    refreshHelper = await ensureRefreshHelper({
      helperUrl,
      startHelper
    });
  } catch (error) {
    await closeServer(dashboardServer);
    throw error;
  }

  async function shutdown() {
    try {
      await closeServer(refreshHelper.server);
      await closeServer(dashboardServer);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    dashboardServer,
    refreshHelper
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startLocal();
}
