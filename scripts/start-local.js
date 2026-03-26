import { fileURLToPath } from "node:url";

import { exportStaticSite } from "./export-static-site.js";
import { startServer } from "../server.js";
import { startRefreshHelper } from "../refresh-helper.js";

const [dashboardServer, refreshHelper] = await (async () => {
  const result = await exportStaticSite();
  console.log(`Exported usage snapshot at ${result.generated_at}`);
  console.log(`Sessions: ${result.session_count}`);
  console.log(`Workspaces: ${result.workspace_count}`);

  return [
    startServer(),
    startRefreshHelper()
  ];
})();

function shutdown() {
  refreshHelper.close(() => {
    dashboardServer.close(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Side effects happen on module load to preserve npm start behavior.
}
