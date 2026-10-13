import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.API_URL || "http://localhost:4000";
  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: true,
      proxy: {
        "/api": apiUrl,
        "/ws": { target: apiUrl, ws: true },
      },
    },
  };
});
