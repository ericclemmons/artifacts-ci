const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let failed = false;
const logRoot = process.env.AGENT_CI_LOG_ROOT ?? "/root/.local/state/agent-ci/logs";
const activeRunners = new Set();
const offsets = new Map();

function scanStepLogs() {
  for (const runner of activeRunners) {
    const stepDir = path.join(logRoot, runner, "steps");
    let logs;
    try {
      logs = fs.readdirSync(stepDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const log of logs) {
      if (!log.isFile() || !log.name.endsWith(".log")) continue;
      if (/^[0-9a-f-]+\.log$/i.test(log.name)) continue;
      drainLog(path.join(stepDir, log.name));
    }
  }
}

function drainLog(file) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }

  let offset = offsets.get(file) ?? 0;
  if (size < offset) {
    offset = 0;
    offsets.set(file, offset);
  }
  if (size <= offset) return;

  offsets.set(file, size);
  const buffer = Buffer.alloc(size - offset);
  const fd = fs.openSync(file, "r");
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
    if (bytesRead > 0) process.stdout.write(buffer.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

const logScan = setInterval(scanStepLogs, 250);

rl.on("line", (line) => {
  if (!line.trim()) return;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    const logDir = line.match(/\bLogs:\s+(\/\S+)\s*$/)?.[1];
    if (logDir) activeRunners.add(path.basename(logDir));
    console.log(line);
    return;
  }

  switch (event.event) {
    case "run.start":
      console.log(`ci: started ${event.runId ?? "run"}`);
      break;
    case "job.start":
      if (event.runner) activeRunners.add(event.runner);
      console.log(`job: ${event.workflow ?? "workflow"} > ${event.job} started`);
      break;
    case "step.start":
      console.log(`step ${event.index}: ${event.step} started`);
      break;
    case "step.finish": {
      if (event.status === "failed") failed = true;
      const marker = event.status === "passed" ? "ok" : event.status;
      const duration = typeof event.durationMs === "number" ? ` (${event.durationMs}ms)` : "";
      console.log(`step ${event.index}: ${event.step} ${marker}${duration}`);
      break;
    }
    case "job.finish":
      if (event.status === "failed") failed = true;
      console.log(`job: ${event.workflow ?? "workflow"} > ${event.job} ${event.status}`);
      break;
    case "run.finish":
      if (event.status === "failed") failed = true;
      console.log(`ci: ${event.status}`);
      break;
    case "diagnostic":
      console.log(`${event.level ?? "info"}: ${event.message}`);
      break;
  }
});

rl.on("close", () => {
  clearInterval(logScan);
  if (failed) process.exit(1);
});
