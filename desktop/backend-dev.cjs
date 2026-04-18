const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const venvPython = path.join(backendDir, ".venv", "Scripts", "python.exe");

const command = fs.existsSync(venvPython) ? venvPython : "py";
const args = fs.existsSync(venvPython) ? ["desktop_server.py"] : ["-3", "backend/desktop_server.py"];
const cwd = fs.existsSync(venvPython) ? backendDir : rootDir;

const child = spawn(command, args, {
  cwd,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
