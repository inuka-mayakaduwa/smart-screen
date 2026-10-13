import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, getToken, setToken } from "./api";
import { LoginPage } from "./LoginPage";
import { RoomPage } from "./RoomPage";
import { RoomsPage } from "./RoomsPage";
import { SettingsPage } from "./SettingsPage";

export function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const navigate = useNavigate();

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api("/api/admin/session")
      .then(() => setAuthed(true))
      .catch(() => {
        setToken(null);
        setAuthed(false);
      })
      .finally(() => setReady(true));
  }, []);

  function signOut() {
    setToken(null);
    setAuthed(false);
    navigate("/");
  }

  if (!ready) return <main className="main">Loading control pane…</main>;
  if (!authed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage onSuccess={() => setAuthed(true)} />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand">
          Control
          <span>Rooms, images, and calendars</span>
        </div>
        <nav>
          <Link to="/rooms">Rooms</Link>
          <Link to="/settings/display">Display defaults</Link>
          <button className="linkish" type="button" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/rooms" replace />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/rooms/:roomId" element={<RoomPage />} />
          <Route path="/settings/display" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/rooms" replace />} />
        </Routes>
      </main>
    </div>
  );
}
