import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const label = "com.kj.codex-usage-dashboard-pages";
const launchAgentsDir = join(os.homedir(), "Library", "LaunchAgents");
const plistPath = join(launchAgentsDir, `${label}.plist`);
const nodePath = process.execPath;
const publishScriptPath = join(repoRoot, "scripts", "publish-pages.js");
const logsDir = join(os.homedir(), "Library", "Logs");

function buildScheduleIntervals() {
  const intervals = [];
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    for (let hour = 8; hour <= 18; hour += 1) {
      intervals.push({ weekday, hour, minute: 0 });
      if (hour !== 18) {
        intervals.push({ weekday, hour, minute: 30 });
      }
    }
  }
  return intervals;
}

function buildPlist() {
  const scheduleIntervals = buildScheduleIntervals().map((entry) => `
    <dict>
      <key>Weekday</key>
      <integer>${entry.weekday}</integer>
      <key>Hour</key>
      <integer>${entry.hour}</integer>
      <key>Minute</key>
      <integer>${entry.minute}</integer>
    </dict>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${publishScriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${repoRoot}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <array>${scheduleIntervals}
    </array>
    <key>StandardOutPath</key>
    <string>${join(logsDir, "codex-usage-dashboard-pages.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(logsDir, "codex-usage-dashboard-pages.err.log")}</string>
  </dict>
</plist>
`;
}

export async function installLaunchAgent() {
  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await writeFile(plistPath, buildPlist(), "utf8");

  try {
    await execFileAsync("launchctl", ["unload", plistPath]);
  } catch {
    // Ignore unload failures when the agent is not already loaded.
  }

  await execFileAsync("launchctl", ["load", plistPath]);
  return {
    plist_path: plistPath,
    label
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await installLaunchAgent();
    console.log(`Installed LaunchAgent ${result.label}`);
    console.log(result.plist_path);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
