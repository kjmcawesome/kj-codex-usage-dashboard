import { symlink, readlink, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Symlink creation atomically stores the PID and token, leaving no empty-lock
// crash window. Existing locks are never removed by another exporter, including
// locks left by an interrupted process. Recovery requires stopping all exporters.
export async function withSnapshotLock(filePath, operation) {
  const token = `${process.pid}:${randomUUID()}`;
  try { await symlink(token, filePath); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("A snapshot lock already exists. If a refresh was interrupted, stop the collector and any build processes, clear the remaining .usage-export.lock file, then retry.");
  }
  try { return await operation(); }
  finally {
    if (await readlink(filePath) === token) await unlink(filePath);
  }
}
