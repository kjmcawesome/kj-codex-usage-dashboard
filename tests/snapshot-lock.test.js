import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, lstat, symlink, readlink } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { withSnapshotLock } from "../lib/snapshot-lock.js";

test("overlapping exports fail before writing and locks release after success or error", async () => {
  const path = join(await mkdtemp(join(os.tmpdir(), "usage-export-lock-")), "export.lock");
  const value = await withSnapshotLock(path, async () => {
    await assert.rejects(withSnapshotLock(path, () => assert.fail("must not enter a second export")), /snapshot lock/);
    return 42;
  });
  assert.equal(value, 42);
  await assert.rejects(lstat(path), { code: "ENOENT" });
  await assert.rejects(withSnapshotLock(path, () => { throw new Error("build failed"); }), /build failed/);
  assert.equal(await withSnapshotLock(path, () => 7), 7);
});

test("concurrent attempts leave an interrupted process lock intact and explain recovery", async () => {
  const path = join(await mkdtemp(join(os.tmpdir(), "usage-dead-export-lock-")), "export.lock");
  const owner = "2147483647:dead-process";
  await symlink(owner, path);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () =>
    withSnapshotLock(path, () => assert.fail("a stale lock must not permit entry"))));
  assert.ok(attempts.every((result) => result.status === "rejected"));
  for (const result of attempts) assert.match(result.reason.message, /stop the collector.*clear the remaining/);
  assert.equal(await readlink(path), owner, "no contender may remove or replace the old lock");
});
