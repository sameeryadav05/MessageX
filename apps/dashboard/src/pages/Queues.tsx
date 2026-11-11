import { useCallback, useState, type FormEvent } from "react";
import { Layers3, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import Panel from "../components/Panel";
import { usePolling } from "../hooks/usePolling";
import {
  createQueue,
  deleteQueue,
  getQueues,
  getQueueStats,
  type CreateQueueInput
} from "../services/api";
import type { Queue } from "../types";

function errorMessage(error: unknown): string {
  const responseMessage = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return responseMessage || (error instanceof Error ? error.message : "Request failed");
}

export default function Queues() {
  const load = useCallback(() => getQueues(), []);
  const q = usePolling(load, 5000);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [durable, setDurable] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);
  const [maxDeliveryCount, setMaxDeliveryCount] = useState("5");
  const [deadLetterQueue, setDeadLetterQueue] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const rows = (q.data ?? []).filter((queue) =>
    queue.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const input: CreateQueueInput = {
      name: name.trim(),
      durable,
      autoDelete,
      maxDeliveryCount: Number(maxDeliveryCount),
      ...(deadLetterQueue.trim() ? { deadLetterQueue: deadLetterQueue.trim() } : {})
    };
    try {
      await createQueue(input);
      setName("");
      setDeadLetterQueue("");
      setMaxDeliveryCount("5");
      setNotice("Queue created successfully.");
      await q.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(queue: Queue) {
    if (!window.confirm(`Delete queue "${queue.name}"? This also removes its stored messages and bindings.`)) return;
    setError("");
    setNotice("");
    try {
      await deleteQueue(queue.name);
      setNotice(`Queue "${queue.name}" deleted.`);
      await q.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  return (
    <div className="stack">
      <div className="intro">
        <div>
          <h2>Queues</h2>
          <p>Create queues, inspect message state, and manage queue lifecycle.</p>
        </div>
        <button className="secondary" onClick={() => void q.refresh()}><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}

      <Panel title="Create queue" subtitle="Declare a durable or transient queue with optional dead-letter handling.">
        <form className="management-form" onSubmit={handleCreate}>
          <label>Queue name<input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="orders.created" /></label>
          <label>Maximum delivery attempts<input required type="number" min="1" step="1" value={maxDeliveryCount} onChange={(event) => setMaxDeliveryCount(event.target.value)} /></label>
          <label className="form-wide">Dead-letter queue <span className="optional">(optional; must already exist)</span>
            <select value={deadLetterQueue} onChange={(event) => setDeadLetterQueue(event.target.value)}>
              <option value="">No dead-letter queue</option>
              {(q.data ?? []).map((queue) => <option key={queue.id} value={queue.name}>{queue.name}</option>)}
            </select>
          </label>
          <label className="check-label"><input type="checkbox" checked={durable} onChange={(event) => setDurable(event.target.checked)} /> Durable</label>
          <label className="check-label"><input type="checkbox" checked={autoDelete} onChange={(event) => setAutoDelete(event.target.checked)} /> Auto delete</label>
          <div className="form-actions"><button className="primary" type="submit" disabled={saving || !name.trim() || !Number.isInteger(Number(maxDeliveryCount)) || Number(maxDeliveryCount) < 1}><Plus size={14} /> {saving ? "Creating…" : "Create queue"}</button></div>
        </form>
      </Panel>

      <Panel title="All queues" subtitle={`${rows.length} queue(s)`} action={<div className="search"><Search size={14} /><input placeholder="Search queues…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Queue</th><th>Durable</th><th>Exclusive</th><th>Auto delete</th><th>Created</th><th>Statistics</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((queue) => <QueueRow key={queue.id} queue={queue} onDelete={() => void handleDelete(queue)} />)}
              {!rows.length && <tr><td colSpan={7} className="empty">{q.loading ? "Loading…" : "No queues found."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function QueueRow({ queue, onDelete }: { queue: Queue; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState("");

  async function toggleStats() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoadingStats(true);
    try {
      setStats(await getQueueStats(queue.name));
      setError("");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoadingStats(false);
    }
  }

  return (
    <>
      <tr>
        <td><b><Layers3 size={14} className="inlineicon" /> {queue.name}</b></td>
        <td>{queue.durable ? "Yes" : "No"}</td>
        <td>{queue.exclusive ? "Yes" : "No"}</td>
        <td>{queue.autoDelete ? "Yes" : "No"}</td>
        <td>{queue.createdAt ? new Date(queue.createdAt).toLocaleString() : "—"}</td>
        <td><button className="linkbutton" onClick={() => void toggleStats()}>{open ? "Hide" : "View"} stats</button></td>
        <td><button className="icon-action danger-action" title={`Delete ${queue.name}`} onClick={onDelete} disabled={queue.exclusive}><Trash2 size={14} /></button></td>
      </tr>
      {open && <tr><td colSpan={7}><div className="detail">{error || (loadingStats ? "Loading queue statistics…" : !stats ? "No statistics available." : <div className="qstats">{[["Total", stats.messages?.total], ["Ready", stats.messages?.ready], ["In flight", stats.messages?.inFlight ?? stats.messages?.inflight], ["Dead", stats.messages?.dead]].map(([label, value]) => <div key={String(label)}><small>{label}</small><b>{value ?? "—"}</b></div>)}</div>)}</div></td></tr>}
    </>
  );
}
