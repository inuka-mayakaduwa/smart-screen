import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type RoomSummary } from "./api";

const ZONES = ["UTC", "Asia/Colombo", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "America/New_York", "Australia/Sydney"];

export function RoomsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Colombo");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ rooms: RoomSummary[] }>("/api/admin/rooms")
      .then((body) => setRooms(body.rooms))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await api<{ room: { id: string } }>("/api/admin/rooms", {
        method: "POST",
        body: { name, timezone },
      });
      navigate(`/rooms/${body.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the room");
    }
  }

  return (
    <>
      <h1 className="page-title">Rooms</h1>
      <p className="lede">Each room has its own name, images, and calendar accounts. A panel joins a room with a Connect token, not with those accounts.</p>
      <form className="panel fields" onSubmit={createRoom}>
        <h2>Create a room</h2>
        <div className="row">
          <label style={{ flex: 1 }}>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Atlas" required />
          </label>
          <label>
            Timezone
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {ZONES.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <button className="primary" type="submit">
            Create
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <div className="grid">
        {rooms.map((room) => (
          <Link
            key={room.id}
            to={`/rooms/${room.id}`}
            className="card"
            style={room.backgroundUrl ? { backgroundImage: `linear-gradient(transparent, transparent), url(${room.backgroundUrl})` } : undefined}
          >
            <div className="shade">
              <strong>{room.name}</strong>
              <small>
                {room.status === "retired" ? "Retired" : room.timezone} · {room.displayCount} panels · {room.connectionCount} calendars
              </small>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
