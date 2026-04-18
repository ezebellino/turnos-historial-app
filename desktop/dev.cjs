const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const frontendUrl = "http://127.0.0.1:5173";
const electronBin = path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

function killProcess(child) {
  if (child && !child.killed) {
    child.kill();
  }
}

async function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No se pudo abrir ${url} a tiempo.`);
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killProcess(electronProcess);
  killProcess(viteProcess);
  process.exit(code);
}

async function main() {
  viteProcess = spawn("npm.cmd", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: frontendDir,
    stdio: "inherit",
    shell: true,
  });

  viteProcess.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  await waitForUrl(frontendUrl);

  if (!fs.existsSync(electronBin)) {
    throw new Error("No se encontro Electron. Ejecuta npm install en la raiz del proyecto.");
  }

  electronProcess = spawn(electronBin, ["."], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      FRONTEND_DEV_URL: frontendUrl,
    },
    shell: true,
  });

  electronProcess.on("exit", (code) => {
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error.message);
  shutdown(1);
});
