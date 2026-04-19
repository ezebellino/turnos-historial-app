const path = require("path");
const fs = require("fs");
const { execFileSync, spawn } = require("child_process");
const { app, BrowserWindow, dialog, shell } = require("electron");

const BACKEND_URL = "http://127.0.0.1:8000/health";
const FRONTEND_DEV_URL = process.env.FRONTEND_DEV_URL || "http://127.0.0.1:5173";
const APP_USER_MODEL_ID = "com.ezebellino.turnoshistorial";
let backendProcess = null;
let backendManagedByApp = false;
let mainWindow = null;

function resolvePortableExecutableDir() {
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
}

function resolvePortableDataDir() {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), ".desktop-data");
  }
  return path.join(resolvePortableExecutableDir(), "TurnosHistorialData");
}

function resolveBackendPython() {
  const venvPython = path.join(app.getAppPath(), "backend", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) {
    return { command: venvPython, args: ["desktop_server.py"] };
  }

  return { command: "py", args: ["-3", "desktop_server.py"] };
}

async function backendIsReachable() {
  try {
    const response = await fetch(BACKEND_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function startBackend() {
  if (!app.isPackaged && (await backendIsReachable())) {
    backendManagedByApp = false;
    return;
  }

  if (app.isPackaged && (await backendIsReachable())) {
    throw new Error(
      "Ya hay otra instancia del backend usando 127.0.0.1:8000. Cierra cualquier Turnos Historial App o backend anterior y vuelve a abrir el portable.",
    );
  }

  const dataDir = resolvePortableDataDir();

  if (app.isPackaged) {
    const backendExe = path.join(process.resourcesPath, "backend", "turnos-historial-backend.exe");
    backendProcess = spawn(backendExe, [], {
      env: {
        ...process.env,
        TURNOS_DATA_DIR: dataDir,
      },
      windowsHide: true,
    });
    backendManagedByApp = true;
    return;
  }

  const backendPython = resolveBackendPython();

  backendProcess = spawn(backendPython.command, backendPython.args, {
    cwd: path.join(app.getAppPath(), "backend"),
    env: {
      ...process.env,
      TURNOS_DATA_DIR: dataDir,
    },
    windowsHide: true,
  });
  backendManagedByApp = true;

  backendProcess.on("exit", (code) => {
    if (code && code !== 0) {
      backendIsReachable().then((reachable) => {
        if (!reachable) {
          dialog.showErrorBox("Backend detenido", `El backend de escritorio finalizo con codigo ${code}.`);
        }
      });
    }
  });
}

async function waitForBackend(timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(BACKEND_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the backend is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error("El backend no respondio a tiempo.");
}

function createWindow() {
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, "iconoTurnosHistorialAPP.ico")
    : path.join(app.getAppPath(), "frontend", "iconoTurnosHistorialAPP.ico");
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f4ede3",
    autoHideMenuBar: true,
    ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && url !== currentUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (!app.isPackaged) {
    window.loadURL(FRONTEND_DEV_URL);
    mainWindow = window;
    return;
  }

  window.loadFile(path.join(app.getAppPath(), "frontend", "dist", "index.html"));
  mainWindow = window;
}

function stopBackend() {
  if (!backendManagedByApp || !backendProcess) {
    return;
  }

  const { pid } = backendProcess;
  if (!pid) {
    backendProcess = null;
    return;
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      backendProcess.kill("SIGKILL");
    }
  } catch {
    try {
      backendProcess.kill("SIGKILL");
    } catch {
      // Ignore shutdown errors if the backend is already gone.
    }
  }

  backendProcess = null;
}

app.whenReady().then(async () => {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
    await startBackend();
    await waitForBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("No se pudo abrir la app", error.message);
    stopBackend();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("browser-window-created", (_, window) => {
  window.on("closed", () => {
    if (window === mainWindow) {
      stopBackend();
    }
  });
});
