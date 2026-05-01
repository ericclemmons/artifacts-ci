#!/usr/bin/env node
import { stat } from "node:fs/promises";
import path from "node:path";

const usage = "Usage: wait-for-socket <path> [--timeout <ms>] [--interval <ms>]";

const args = process.argv.slice(2);
const socketPath = args[0];
const timeoutMs = readNumberOption(args, "--timeout", 10_000);
const intervalMs = readNumberOption(args, "--interval", 100);

if (!socketPath) {
  console.error(usage);
  process.exit(2);
}

const resolvedSocketPath = path.resolve(socketPath);
const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  if (await isSocket(resolvedSocketPath)) process.exit(0);
  await sleep(intervalMs);
}

console.error(`Timed out waiting for socket: ${resolvedSocketPath}`);
process.exit(1);

function readNumberOption(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;

  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

async function isSocket(filePath: string) {
  try {
    return (await stat(filePath)).isSocket();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
