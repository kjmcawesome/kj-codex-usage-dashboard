import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { exportStaticSite } from "./export-static-site.js";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distRoot = join(repoRoot, "dist");
const worktreeRoot = join(repoRoot, ".pages-worktree");
const branchName = "gh-pages";

async function runGit(args, options = {}) {
  return execFileAsync("git", args, {
    cwd: repoRoot,
    ...options
  });
}

async function runGitInWorktree(args) {
  return execFileAsync("git", args, {
    cwd: worktreeRoot
  });
}

async function ensureOriginRemote() {
  try {
    const { stdout } = await runGit(["remote", "get-url", "origin"]);
    return stdout.trim();
  } catch {
    throw new Error("Git remote `origin` is not configured. Create the GitHub repo and add the remote before publishing Pages.");
  }
}

async function ensureWorktree() {
  const remoteExists = await ensureOriginRemote();
  void remoteExists;

  await rm(worktreeRoot, { recursive: true, force: true });
  await mkdir(worktreeRoot, { recursive: true });

  let remoteBranchExists = false;
  try {
    await runGit(["fetch", "origin", branchName]);
    remoteBranchExists = true;
  } catch {
    remoteBranchExists = false;
  }

  if (remoteBranchExists) {
    await runGit(["worktree", "add", "-B", branchName, worktreeRoot, `origin/${branchName}`]);
    return;
  }

  await runGit(["worktree", "add", "--detach", worktreeRoot]);
  await runGitInWorktree(["checkout", "--orphan", branchName]);
}

async function clearWorktree() {
  const entries = await readdir(worktreeRoot, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.name !== ".git")
    .map((entry) => rm(join(worktreeRoot, entry.name), { recursive: true, force: true })));
}

async function copyDistToWorktree() {
  const entries = await readdir(distRoot, { withFileTypes: true });
  await Promise.all(entries.map((entry) =>
    cp(join(distRoot, entry.name), join(worktreeRoot, entry.name), { recursive: true })
  ));
}

async function commitIfChanged() {
  await runGitInWorktree(["add", "."]);
  const { stdout: status } = await runGitInWorktree(["status", "--short"]);
  if (!status.trim()) {
    return false;
  }

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const { stdout: configuredName } = await runGit(["config", "user.name"]).catch(() => ({ stdout: "" }));
  const { stdout: configuredEmail } = await runGit(["config", "user.email"]).catch(() => ({ stdout: "" }));
  const name = configuredName.trim();
  const email = configuredEmail.trim();
  if (!name || !email) {
    throw new Error("Git user.name and user.email must be configured before publishing Pages.");
  }

  await execFileAsync("git", ["commit", "-m", `Update usage snapshot ${timestamp}`], {
    cwd: worktreeRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_COMMITTER_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_EMAIL: email
    }
  });
  await runGitInWorktree(["push", "origin", `${branchName}:${branchName}`]);
  return true;
}

async function cleanupWorktree() {
  try {
    await runGit(["worktree", "remove", worktreeRoot, "--force"]);
  } catch {
    await rm(worktreeRoot, { recursive: true, force: true });
  }
}

export async function publishPages() {
  const exportResult = await exportStaticSite();

  try {
    await ensureWorktree();
    await clearWorktree();
    await copyDistToWorktree();
    const pushed = await commitIfChanged();
    return {
      ...exportResult,
      branch: branchName,
      pushed
    };
  } finally {
    await cleanupWorktree();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await publishPages();
    if (result.pushed) {
      console.log(`Published snapshot to ${result.branch}`);
    } else {
      console.log("No snapshot changes detected; nothing published.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
