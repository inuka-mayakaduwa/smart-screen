import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const cmd = path.join(root, "scripts", "share-desktop-dev-win.cmd");
  const child = spawn(`"${cmd}"`, [], { cwd: root, stdio: "inherit", shell: true });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
} else {
  const cargoBin = path.join(process.env.HOME || "", ".cargo", "bin");
  const child = spawn("npm", ["run", "tauri", "dev", "--prefix", "apps/share-desktop"], {
    cwd: root,
    env: { ...process.env, PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ""}` },
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
