const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const preferredPyLauncher = "py";
const preferredPyArgs = ["-3.10"];

const usePreferredPy = true;
const command = usePreferredPy ? preferredPyLauncher : venvPython;
const args = usePreferredPy
  ? [...preferredPyArgs, "-m", "PyInstaller", "--noconfirm", "turnos_historial.spec"]
  : ["-m", "PyInstaller", "--noconfirm", "turnos_historial.spec"];
const cwd = backendDir;

const child = spawn(command, args, {
  cwd,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
