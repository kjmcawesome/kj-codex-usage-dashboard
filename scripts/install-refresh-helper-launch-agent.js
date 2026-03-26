import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const label = "com.kj.codex-usage-dashboard-refresh-helper";
const launchAgentsDir = join(os.homedir(), "Library", "LaunchAgents");
const plistPath = join(launchAgentsDir, `${label}.plist`);
const nodePath = process.execPath;
const helperScriptPath = join(repoRoot, "refresh-helper.js");
const logsDir = join(os.homedir(), "Library", "Logs");

function buildPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${helperScriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${repoRoot}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(logsDir, "codex-usage-dashboard-refresh-helper.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(logsDir, "codex-usage-dashboard-refresh-helper.err.log")}</string>
  </dict>
</plist>
`;
}

export async function installRefreshHelperLaunchAgent() {
  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await writeFile(plistPath, buildPlist(), "utf8");

  try {
    await execFileAsync("launchctl", ["unload", plistPath]);
  } catch {
    // Ignore unload failures when the agent is not already loaded.
  }

  await execFileAsync("launchctl", ["load", plistPath]);

  if (typeof process.getuid === "function") {
    await execFileAsync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${label}`]);
  }

  return {
    plist_path: plistPath,
    label
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await installRefreshHelperLaunchAgent();
    console.log(`Installed LaunchAgent ${result.label}`);
    console.log(result.plist_path);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
