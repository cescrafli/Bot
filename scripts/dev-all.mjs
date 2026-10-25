import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const serverDir = path.join(rootDir, "apps", "server");
const webDir = path.join(rootDir, "apps", "web");

const tsxBin = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

// ANSI Colors
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

console.log(`${CYAN}=====================================================${RESET}`);
console.log(`${MAGENTA}🚀 Memulai Celyn AI BOT (Backend + Frontend)...${RESET}`);
console.log(`${CYAN}=====================================================${RESET}\n`);

function pipeOutput(stream, prefix, color) {
  if (!stream) return;
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`${color}${prefix}${RESET} ${line}`);
      }
    }
  });
}

// 1. Jalankan Backend Server (port 3001)
const serverProc = spawn(process.execPath, [tsxBin, "watch", "src/index.ts"], {
  cwd: serverDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

pipeOutput(serverProc.stdout, "[SERVER]", CYAN);
pipeOutput(serverProc.stderr, "[SERVER:ERR]", RED);

// 2. Jalankan Frontend Web (port 5173)
const webProc = spawn(process.execPath, [viteBin], {
  cwd: webDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

pipeOutput(webProc.stdout, "[WEB]", GREEN);
pipeOutput(webProc.stderr, "[WEB:ERR]", RED);

serverProc.on("error", (err) => console.error(`${RED}[SERVER:ERR] ${err.message}${RESET}`));
webProc.on("error", (err) => console.error(`${RED}[WEB:ERR] ${err.message}${RESET}`));

let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${YELLOW}🛑 Menghentikan seluruh proses Celyn AI BOT...${RESET}`);

  try {
    if (serverProc.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", serverProc.pid.toString(), "/T", "/F"]);
      } else {
        serverProc.kill("SIGTERM");
      }
    }
    if (webProc.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", webProc.pid.toString(), "/T", "/F"]);
      } else {
        webProc.kill("SIGTERM");
      }
    }
  } catch (err) {
    // Ignore error on exit
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

serverProc.on("close", (code) => {
  if (!isShuttingDown && code !== 0) {
    console.log(`${RED}[SERVER] Proses server berhenti dengan kode ${code}${RESET}`);
  }
});

webProc.on("close", (code) => {
  if (!isShuttingDown && code !== 0) {
    console.log(`${RED}[WEB] Proses web berhenti dengan kode ${code}${RESET}`);
  }
});
