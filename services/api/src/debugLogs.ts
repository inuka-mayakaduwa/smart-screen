import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DebugLevel = "info" | "warn" | "error" | "network";

export type DebugLine = {
  at: string;
  level: DebugLevel;
  scope: string;
  message: string;
  detail?: string;
};

export type DebugReport = {
  id: string;
  deviceId: string;
  deviceLabel: string;
  roomId: string;
  roomName: string;
  submittedAt: string;
  lines: DebugLine[];
};

export type DebugReportSummary = Omit<DebugReport, "lines"> & { lineCount: number };

const MAX_REPORTS = 40;
const LEVELS = new Set<DebugLevel>(["info", "warn", "error", "network"]);

export function createDebugLogs(dir: string) {
  mkdirSync(dir, { recursive: true });

  function save(report: DebugReport) {
    const file = fileFor(report.id);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(report));
    renameSync(temp, file);
    prune();
  }

  function list(): DebugReportSummary[] {
    return readAll()
      .map(({ lines, ...summary }) => ({ ...summary, lineCount: lines.length }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  function read(id: string): DebugReport | null {
    if (!safeId(id)) return null;
    const file = fileFor(id);
    try {
      return normalize(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return null;
    }
  }

  function remove(id: string) {
    if (!safeId(id)) return false;
    const file = fileFor(id);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  }

  function prune() {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(dir, name);
        return { file, mtime: statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const extra of files.slice(MAX_REPORTS)) rmSync(extra.file, { force: true });
  }

  function readAll(): DebugReport[] {
    const reports: DebugReport[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const report = normalize(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
        if (report) reports.push(report);
      } catch {
        // A half-written file is skipped until the next submit replaces it.
      }
    }
    return reports;
  }

  function fileFor(id: string) {
    return path.join(dir, `${id}.json`);
  }

  return { save, list, read, remove };
}

export function formatDebugReport(report: DebugReport): string {
  const head = [
    `room: ${report.roomName}`,
    `device: ${report.deviceLabel}`,
    `submitted: ${report.submittedAt}`,
    "",
  ];
  const body = report.lines.map((line) => {
    const clock = line.at;
    const text = `${clock}  ${line.level}  ${line.scope}  ${line.message}`;
    return line.detail ? `${text}\n  ${line.detail}` : text;
  });
  return [...head, ...body].join("\n");
}

export function normalizeDebugLines(value: unknown): DebugLine[] {
  if (!Array.isArray(value)) throw new Error("Debug logs must include a lines array");
  if (value.length > 400) throw new Error("Send at most 400 debug lines");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each debug line must be an object");
    const line = entry as Partial<DebugLine>;
    const level = LEVELS.has(line.level as DebugLevel) ? (line.level as DebugLevel) : "info";
    const message = clip(line.message, 300);
    if (!message) throw new Error("Each debug line needs a message");
    const detail = line.detail === undefined ? undefined : clip(line.detail, 2000);
    return {
      at: typeof line.at === "string" && line.at.trim() ? line.at.trim().slice(0, 40) : new Date().toISOString(),
      level,
      scope: clip(line.scope, 40) || "app",
      message,
      ...(detail ? { detail } : {}),
    };
  });
}

function clip(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function normalize(value: unknown): DebugReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<DebugReport>;
  if (!report.id || !safeId(report.id) || !Array.isArray(report.lines)) return null;
  return {
    id: report.id,
    deviceId: clip(report.deviceId, 80),
    deviceLabel: clip(report.deviceLabel, 80) || "Panel",
    roomId: clip(report.roomId, 80),
    roomName: clip(report.roomName, 120) || "Room",
    submittedAt: clip(report.submittedAt, 40) || new Date(0).toISOString(),
    lines: report.lines.filter((line) => line && typeof line.message === "string"),
  };
}
