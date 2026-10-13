import { FormEvent, useState } from "react";
import { api, setToken } from "./api";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await api<{ token: string }>("/api/admin/login", {
        method: "POST",
        body: { password },
      });
      setToken(result.token);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <h2>Control pane</h2>
        <p className="muted">Sign in to create rooms and connect calendars. Panels never use this password.</p>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
