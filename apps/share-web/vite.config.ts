import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const certDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "certs");
const certFile = path.join(certDir, "cert.pem");
const keyFile = path.join(certDir, "key.pem");
const https =
  fs.existsSync(certFile) && fs.existsSync(keyFile)
    ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
    : undefined;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = process.env.API_URL || env.API_URL || "http://localhost:4000";
  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: true,
      https,
      allowedHosts: true,
      proxy: {
        "/api": apiUrl,
        "/ws": { target: apiUrl, ws: true },
      },
      watch: process.env.CHOKIDAR_USEPOLLING === "1" ? { usePolling: true, interval: 300 } : undefined,
    },
  };
});
