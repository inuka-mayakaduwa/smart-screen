import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "./api";

type ReportSummary = {
  id: string;
  deviceId: string;
  deviceLabel: string;
  roomId: string;
  roomName: string;
  submittedAt: string;
  lineCount: number;
};

export function DebugLogsPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const body = await api<{ reports: ReportSummary[] }>("/api/admin/debug-logs");
    setReports(body.reports);
    setSelected((current) => current || body.reports[0]?.id || "");
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load debug logs"));
    const timer = setInterval(() => {
      load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setText("");
      return;
    }
    let stopped = false;
    api<{ text: string }>(`/api/admin/debug-logs/${selected}`)
      .then((body) => {
        if (!stopped) setText(body.text);
      })
      .catch((err) => {
        if (!stopped) setError(err instanceof Error ? err.message : "Could not open that log");
      });
    return () => {
      stopped = true;
    };
  }, [selected]);

  async function remove(id: string) {
    setBusy(id);
    setError("");
    try {
      await api(`/api/admin/debug-logs/${id}`, { method: "DELETE" });
      setSelected((current) => (current === id ? "" : current));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that log");
    } finally {
      setBusy("");
    }
  }

  async function download(report: ReportSummary) {
    setBusy(report.id);
    setError("");
    try {
      const headers = new Headers();
      const token = getToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`/api/admin/debug-logs/${report.id}/export`, { headers });
      if (!response.ok) throw new Error("Could not export that log");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `debug-${report.roomName.replace(/\s+/g, "-")}-${report.submittedAt.slice(0, 19).replace(/[:]/g, "")}.log`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export that log");
    } finally {
      setBusy("");
    }
  }

  const open = reports.find((report) => report.id === selected);

  return (
    <>
      <h1 className="page-title">Debug logs</h1>
      <p className="lede">Logs a panel submits from Debug mode. This list refreshes every few seconds. Open one to read it, or export the file.</p>
      {error ? <p className="error">{error}</p> : null}
      {reports.length === 0 ? <p className="muted">No panel has submitted debug logs yet.</p> : null}
      {reports.length > 0 ? (
        <div className="debug-layout">
          <div className="debug-list">
            {reports.map((report) => (
              <button key={report.id} type="button" className={report.id === selected ? "debug-item is-on" : "debug-item"} onClick={() => setSelected(report.id)}>
                <strong>{report.roomName}</strong>
                <span>{report.deviceLabel}</span>
                <small>
                  {new Date(report.submittedAt).toLocaleString()} · {report.lineCount} lines
                </small>
              </button>
            ))}
          </div>
          <section className="panel debug-view-wrap">
            <div className="actions">
              <div>
                <strong>{open?.roomName}</strong>
                <p className="muted">{open ? `${open.deviceLabel} · ${open.lineCount} lines` : ""}</p>
              </div>
              <button className="ghost" type="button" disabled={!open || busy === open.id} onClick={() => open && void download(open)}>
                Export
              </button>
              <button className="danger" type="button" disabled={!open || busy === open.id} onClick={() => open && void remove(open.id)}>
                Delete
              </button>
            </div>
            <pre className="debug-view">{text}</pre>
          </section>
        </div>
      ) : null}
    </>
  );
}
