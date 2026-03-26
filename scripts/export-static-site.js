import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicSnapshot, loadUsageIndex } from "../lib/usage-data.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const publicRoot = join(repoRoot, "public");
const distRoot = join(repoRoot, "dist");
const localSnapshotPath = join(publicRoot, "data", "usage-snapshot.json");
const distSnapshotPath = join(distRoot, "data", "usage-snapshot.json");

async function writeJson(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function write404Page(distDir) {
  const indexHtml = await readFile(join(distDir, "index.html"), "utf8");
  await writeFile(join(distDir, "404.html"), indexHtml, "utf8");
}

export async function exportStaticSite() {
  const index = await loadUsageIndex();
  const snapshot = createPublicSnapshot(index);

  await mkdir(join(publicRoot, "data"), { recursive: true });
  await writeJson(localSnapshotPath, snapshot);

  await rm(distRoot, { recursive: true, force: true });
  await cp(publicRoot, distRoot, { recursive: true });
  await writeJson(distSnapshotPath, snapshot);
  await write404Page(distRoot);

  return {
    generated_at: snapshot.generated_at,
    session_count: snapshot.sessions.length,
    workspace_count: snapshot.workspaces.length,
    public_snapshot_path: localSnapshotPath,
    dist_snapshot_path: distSnapshotPath,
    dist_root: distRoot
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await exportStaticSite();
  console.log(`Exported usage snapshot at ${result.generated_at}`);
  console.log(`Sessions: ${result.session_count}`);
  console.log(`Workspaces: ${result.workspace_count}`);
  console.log(`Local snapshot: ${result.public_snapshot_path}`);
  console.log(`Static site: ${result.dist_root}`);
}
