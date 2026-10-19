import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = process.env.API_URL || env.API_URL || "http://localhost:4000";
  return {
    base: command === "build" ? "/admin/" : "/",
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      allowedHosts: true,
      proxy: {
        "/api": apiUrl,
        "/media": apiUrl,
      },
      watch: process.env.CHOKIDAR_USEPOLLING === "1" ? { usePolling: true, interval: 300 } : undefined,
    },
  };
});
