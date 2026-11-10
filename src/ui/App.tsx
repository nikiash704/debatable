import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { normalizeCode } from "../shared/code";
import {
  claimRoom,
  createRoomEntry,
  getLastRoom,
  getRoom,
  removeRoom,
  roomExists,
  saveRoom,
  blankEntry,
  updateRoom,
  type RoomEntry,
} from "../sync/rooms";
import { Gallery } from "./dev/Gallery";
import { navigate, roomPath, usePath } from "./router";
import { RoomScreen } from "./RoomScreen";

export function App() {
  const path = usePath();
  if (path === "/dev/gallery") return <Gallery />;
  const m = path.match(/^\/r\/([^/]+)\/?$/);
  if (m) return <RoomGate key={m[1]} raw={decodeURIComponent(m[1])} />;
  return <Home />;
}

/** "/": reopen the last round on this device without asking anything, or start a new one (spec 01). */
function Home() {
  useEffect(() => {
    const last = getLastRoom();
    if (last && getRoom(last)) navigate(roomPath(last), true);
    else navigate(roomPath(createRoomEntry().code), true);
  }, []);
  return null;
}

export function startNewRound() {
  navigate(roomPath(createRoomEntry().code));
}

type GateState = { kind: "checking" } | { kind: "ready"; entry: RoomEntry } | { kind: "missing"; code: string } | { kind: "invalid"; raw: string };

/** Resolves a code to a room on this device: known locally, verified on the server, or not found. */
function RoomGate({ raw }: { raw: string }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    const code = normalizeCode(raw);
    if (!code) {
      setState({ kind: "invalid", raw });
      return;
    }
    if (code !== raw) {
      navigate(roomPath(code), true);
      return;
    }
    const known = getRoom(code);
    if (known) {
      setState({ kind: "ready", entry: known });
      return;
    }
    let cancelled = false;
    void roomExists(code).then((r) => {
      if (cancelled) return;
      if (r === "missing") {
        setState({ kind: "missing", code });
        return;
      }
      // joining a partner's room (or opening a link while offline: checked again when online)
      const entry = { ...blankEntry(code, false), verified: r === "exists" };
      saveRoom(entry);
      setState({ kind: "ready", entry });
    });
    return () => {
      cancelled = true;
    };
  }, [raw]);

  if (state.kind === "ready") return <RoomScreen code={state.entry.code} />;
  if (state.kind === "missing" || state.kind === "invalid") {
    return <NotFound code={state.kind === "missing" ? state.code : state.raw} invalid={state.kind === "invalid"} />;
  }
  return <div className="app" aria-busy="true" />;
}

function NotFound({ code, invalid }: { code: string; invalid: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  return (
    <div className="overlay" style={{ background: "var(--c-page)" }}>
      <div className="panel dialog" data-testid="not-found">
        <h2>{invalid ? "That is not a round code" : `No round with code ${code}`}</h2>
        <p>
          {invalid
            ? "Codes are 5 letters and digits, for example K7F2Q."
            : "Check the code with your partner. Codes never expire, so a typo is the usual reason."}
        </p>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalizeCode(value);
            if (!c) setError(true);
            else navigate(roomPath(c));
          }}
        >
          <input
            className="join__input"
            style={{ width: 160 }}
            placeholder="Have a code?"
            value={value}
            aria-invalid={error}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
          />
          <button className="btn btn--outline" type="submit">
            Open →
          </button>
        </form>
        <div className="dialog__actions">
          <button className="btn btn--dark" type="button" onClick={startNewRound}>
            Start a new round
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Background reservation of a code created on this device. If another room already owns the code
 * (very unlikely: 28 million codes), the local round moves to a fresh code.
 */
export async function ensureVerified(entry: RoomEntry, doc: Y.Doc): Promise<"ok" | "offline" | "moved" | "missing"> {
  if (entry.verified) return "ok";
  if (entry.createdHere) {
    const r = await claimRoom(entry);
    if (r === "ok") {
      updateRoom(entry.code, { verified: true });
      return "ok";
    }
    if (r === "offline") return "offline";
    await moveToNewCode(entry, doc);
    return "moved";
  }
  const r = await roomExists(entry.code);
  if (r === "exists") {
    updateRoom(entry.code, { verified: true });
    return "ok";
  }
  return r === "offline" ? "offline" : "missing";
}

async function moveToNewCode(entry: RoomEntry, doc: Y.Doc) {
  const fresh = createRoomEntry();
  const update = Y.encodeStateAsUpdate(doc);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, update);
  const idb = new IndexeddbPersistence(`debatable:${fresh.code}`, copy);
  await idb.whenSynced;
  await idb.destroy();
  saveRoom({ ...entry, code: fresh.code, roomId: fresh.roomId, verified: false, openedAt: Date.now() });
  removeRoom(entry.code);
  const old = new IndexeddbPersistence(`debatable:${entry.code}`, new Y.Doc());
  await old.whenSynced;
  await old.clearData();
  navigate(roomPath(fresh.code), true);
}
