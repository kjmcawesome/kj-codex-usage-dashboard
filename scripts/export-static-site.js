import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createPublicSnapshot, loadUsageIndex } from "../lib/usage-data.js";
import { PRICING } from "../public/pricing.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const publicRoot = join(repoRoot, "public");
const distRoot = join(repoRoot, "dist");
const localSnapshotPath = join(publicRoot, "data", "usage-snapshot.json");
const distSnapshotPath = join(distRoot, "data", "usage-snapshot.json");
const execFileAsync = promisify(execFile);

async function writeJson(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function write404Page(distDir) {
  const indexHtml = await readFile(join(distDir, "index.html"), "utf8");
  await writeFile(join(distDir, "404.html"), indexHtml, "utf8");
}

export async function exportStaticSite(options = {}) {
  const index = await loadUsageIndex(options);
  const snapshot = createPublicSnapshot(index);

  await mkdir(join(publicRoot, "data"), { recursive: true });
  await cp(join(repoRoot, "config", "project-impact.json"), join(publicRoot, "data", "project-impact.json"));
  await writeJson(localSnapshotPath, snapshot);
  const { stdout: sourceCommit } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  await writeJson(join(publicRoot, "data", "build-info.json"), {
    release: "work-cost-3-models-2", counting_version: snapshot.counting_version,
    source_commit: sourceCommit.trim(),
    generated_at: snapshot.generated_at, pricing_checked_at: PRICING.checked_at,
    snapshot_sha256: createHash("sha256").update(await readFile(localSnapshotPath)).digest("hex")
  });

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
