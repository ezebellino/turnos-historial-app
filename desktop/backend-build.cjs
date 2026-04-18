const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const venvPython = path.join(backendDir, ".venv", "Scripts", "python.exe");

const command = fs.existsSync(venvPython) ? venvPython : "py";
const args = fs.existsSync(venvPython)
  ? ["-m", "PyInstaller", "--noconfirm", "turnos_historial.spec"]
  : ["-3", "-m", "PyInstaller", "--noconfirm", "backend/turnos_historial.spec"];
const cwd = fs.existsSync(venvPython) ? backendDir : rootDir;

const child = spawn(command, args, {
  cwd,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
