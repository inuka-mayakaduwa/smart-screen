import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export type Config = {
  port: number;
  dataDir: string;
  publicApiUrl: string;
  adminOrigin: string;
  shareWebOrigin: string;
  adminPassword: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftRedirectUri: string;
  turnUrl: string;
  turnUsername: string;
  turnPassword: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4000),
    dataDir: env.DATA_DIR ?? path.resolve(here, "../data"),
    publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT ?? 4000}`).replace(/\/$/, ""),
    adminOrigin: (env.ADMIN_ORIGIN ?? "http://localhost:5173").replace(/\/$/, ""),
    shareWebOrigin: (env.SHARE_WEB_ORIGIN ?? "http://localhost:5174").replace(/\/$/, ""),
    adminPassword: env.ADMIN_PASSWORD ?? "change-me",
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirectUri: env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/api/oauth/google/callback",
    microsoftClientId: env.MICROSOFT_CLIENT_ID ?? "",
    microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    microsoftRedirectUri: env.MICROSOFT_REDIRECT_URI ?? "http://localhost:4000/api/oauth/microsoft/callback",
    turnUrl: env.TURN_URL ?? "",
    turnUsername: env.TURN_USERNAME ?? "",
    turnPassword: env.TURN_PASSWORD ?? "",
  };
}

export function iceServers(config: Config) {
  const servers: { urls: string; username?: string; credential?: string }[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  if (config.turnUrl) {
    servers.push({
      urls: config.turnUrl,
      username: config.turnUsername,
      credential: config.turnPassword,
    });
  }
  return servers;
}
