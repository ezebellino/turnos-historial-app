const { spawn } = require("child_process");

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      if ((code ?? 1) === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} fallo con codigo ${code ?? 1}.`));
    });
  });
}

async function runElectronBuilderWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await run("npx", ["electron-builder", "--win", "portable"], "electron-builder");
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.error(`Reintentando portable (${attempt}/${maxAttempts - 1}) por fallo externo de descarga...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  await run("npm", ["run", "frontend:build"], "frontend build");
  await run("npm", ["run", "backend:build"], "backend build");
  await runElectronBuilderWithRetry();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
