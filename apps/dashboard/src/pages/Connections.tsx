import { useCallback, useState } from "react";
import { Cable, RefreshCw, Search } from "lucide-react";
import Panel from "../components/Panel";
import StatusPill from "../components/StatusPill";
import { usePolling } from "../hooks/usePolling";
import { getConnections } from "../services/api";
export default function Connections() {
  const load = useCallback(() => getConnections(), []);
  const q = usePolling(load, 3000);
  const [s, setS] = useState("");
  const rows = (q.data ?? []).filter((x) =>
    `${x.clientName ?? ""} ${x.username ?? ""} ${x.remoteAddress ?? ""}`
      .toLowerCase()
      .includes(s.toLowerCase()),
  );
  return (
    <div className="stack">
      <div className="intro">
        <div>
          <h2>Connections</h2>
          <p>Connected TCP clients and authentication state.</p>
        </div>
        <button className="secondary" onClick={() => void q.refresh()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="stats">
        <div className="stat-card">
          <div className="stat-head">
            <span>Active connections</span>
            <Cable size={17} />
          </div>
          <strong>{q.data?.length ?? "—"}</strong>
        </div>
        <div className="stat-card">
          <div className="stat-head">
            <span>Authenticated</span>
          </div>
          <strong>
            {q.data?.filter((x) => x.authenticated).length ?? "—"}
          </strong>
        </div>
      </div>
      <Panel
        title="TCP connections"
        subtitle="Live connection registry"
        action={
          <div className="search">
            <Search size={14} />
            <input
              placeholder="Search clients…"
              value={s}
              onChange={(e) => setS(e.target.value)}
            />
          </div>
        }
      >
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Username</th>
                <th>Remote address</th>
                <th>Connected</th>
                <th>Authenticated</th>
                <th>Connection ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.clientName || "Unknown"}</b>
                  </td>
                  <td>{x.username || "—"}</td>
                  <td>
                    {x.remoteAddress || "—"}
                    {x.remotePort ? ":" + x.remotePort : ""}
                  </td>
                  <td>
                    <StatusPill status={x.connected} />
                  </td>
                  <td>
                    <StatusPill status={x.authenticated} />
                  </td>
                  <td>
                    <code>{x.id}</code>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    No active connections.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
