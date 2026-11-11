import { useCallback, useState, type FormEvent } from "react";
import { GitBranch, Link2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import Panel from "../components/Panel";
import { usePolling } from "../hooks/usePolling";
import {
  createBinding,
  createExchange,
  deleteBinding,
  deleteExchange,
  getBindings,
  getExchanges,
  getQueues,
  publishMessage,
  type CreateBindingInput,
  type CreateExchangeInput
} from "../services/api";

function errorMessage(error: unknown): string {
  const responseMessage = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return responseMessage || (error instanceof Error ? error.message : "Request failed");
}

export default function Exchanges() {
  const load = useCallback(async () => {
    const [exchanges, bindings, queues] = await Promise.all([getExchanges(), getBindings(), getQueues()]);
    return { exchanges, bindings, queues };
  }, []);
  const query = usePolling(load, 5000);
  const exchanges = query.data?.exchanges ?? [];
  const bindings = query.data?.bindings ?? [];
  const queues = query.data?.queues ?? [];

  const [exchangeName, setExchangeName] = useState("");
  const [exchangeType, setExchangeType] = useState<CreateExchangeInput["type"]>("direct");
  const [exchangeDurable, setExchangeDurable] = useState(true);
  const [bindingExchange, setBindingExchange] = useState("");
  const [bindingQueue, setBindingQueue] = useState("");
  const [routingKey, setRoutingKey] = useState("");
  const [bindingArguments, setBindingArguments] = useState("");
  const [publishExchange, setPublishExchange] = useState("");
  const [publishRoutingKey, setPublishRoutingKey] = useState("");
  const [payload, setPayload] = useState('{"hello":"MessageX"}');
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function runAction(key: string, action: () => Promise<void>, success: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await query.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy("");
    }
  }

  async function handleCreateExchange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("exchange", async () => {
      await createExchange({ name: exchangeName.trim(), type: exchangeType, durable: exchangeDurable });
      setExchangeName("");
    }, "Exchange created successfully.");
  }

  async function handleCreateBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("binding", async () => {
      const input: CreateBindingInput = {
        exchangeName: bindingExchange,
        queueName: bindingQueue,
        routingKey,
        ...(bindingArguments.trim() ? { arguments: JSON.parse(bindingArguments) as Record<string, unknown> } : {})
      };
      await createBinding(input);
      setRoutingKey("");
      setBindingArguments("");
    }, "Binding created successfully.");
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("publish", async () => {
      const message = JSON.parse(payload) as unknown;
      const parsedHeaders = headers.trim() ? JSON.parse(headers) as Record<string, unknown> : undefined;
      const result = await publishMessage({
        exchangeName: publishExchange,
        routingKey: publishRoutingKey,
        message,
        ...(parsedHeaders ? { headers: parsedHeaders } : {})
      });
      setNotice(`Message published. Routed to ${result.routedQueues} queue(s).`);
    }, "Message published.");
  }

  async function handleDeleteExchange(name: string) {
    if (!window.confirm(`Delete exchange "${name}"?`)) return;
    await runAction(`delete-exchange-${name}`, () => deleteExchange(name), `Exchange "${name}" deleted.`);
  }

  async function handleDeleteBinding(binding: CreateBindingInput) {
    if (!window.confirm(`Remove binding from "${binding.exchangeName}" to "${binding.queueName}"?`)) return;
    await runAction("delete-binding", () => deleteBinding(binding), "Binding removed.");
  }

  return (
    <div className="stack">
      <div className="intro">
        <div><h2>Exchanges & bindings</h2><p>Configure routing relationships and publish test messages.</p></div>
        <button className="secondary" onClick={() => void query.refresh()}><RefreshCw size={14} /> Refresh</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}

      <div className="stats">
        {[[GitBranch, "Exchanges", exchanges.length], [Link2, "Bindings", bindings.length]].map(([Icon, label, value]: any) => <div className="stat-card" key={label}><div className="stat-head"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong></div>)}
      </div>

      <Panel title="Create exchange" subtitle="Choose the routing strategy used by this exchange.">
        <form className="management-form" onSubmit={(event) => void handleCreateExchange(event)}>
          <label>Exchange name<input required maxLength={255} value={exchangeName} onChange={(event) => setExchangeName(event.target.value)} placeholder="orders" /></label>
          <label>Type<select value={exchangeType} onChange={(event) => setExchangeType(event.target.value as CreateExchangeInput["type"])}><option value="direct">Direct</option><option value="fanout">Fanout</option><option value="topic">Topic</option><option value="headers">Headers</option></select></label>
          <label className="check-label"><input type="checkbox" checked={exchangeDurable} onChange={(event) => setExchangeDurable(event.target.checked)} /> Durable</label>
          <div className="form-actions"><button className="primary" type="submit" disabled={busy !== "" || !exchangeName.trim()}><Plus size={14} /> {busy === "exchange" ? "Creating…" : "Create exchange"}</button></div>
        </form>
      </Panel>

      <Panel title="Exchanges" subtitle={`${exchanges.length} exchange(s)`}>
        <div className="tablewrap"><table><thead><tr><th>Name</th><th>Type</th><th>Durable</th><th>Bindings</th><th>Created</th><th>Actions</th></tr></thead><tbody>
          {exchanges.map((exchange) => <tr key={exchange.id}><td><b>{exchange.name}</b></td><td><span className="tag">{exchange.type}</span></td><td>{exchange.durable ? "Yes" : "No"}</td><td>{bindings.filter((binding) => binding.exchangeName === exchange.name).length}</td><td>{exchange.createdAt ? new Date(exchange.createdAt).toLocaleString() : "—"}</td><td><button className="icon-action danger-action" title={`Delete ${exchange.name}`} onClick={() => void handleDeleteExchange(exchange.name)} disabled={busy !== ""}><Trash2 size={14} /></button></td></tr>)}
          {!exchanges.length && <tr><td colSpan={6} className="empty">{query.loading ? "Loading…" : "No exchanges found."}</td></tr>}
        </tbody></table></div>
      </Panel>

      <Panel title="Create binding" subtitle="Connect an exchange to a queue using a routing key and optional JSON arguments.">
        <form className="management-form" onSubmit={(event) => void handleCreateBinding(event)}>
          <label>Exchange<select required value={bindingExchange} onChange={(event) => setBindingExchange(event.target.value)}><option value="">Select exchange</option>{exchanges.map((exchange) => <option key={exchange.id} value={exchange.name}>{exchange.name} ({exchange.type})</option>)}</select></label>
          <label>Queue<select required value={bindingQueue} onChange={(event) => setBindingQueue(event.target.value)}><option value="">Select queue</option>{queues.map((queue) => <option key={queue.id} value={queue.name}>{queue.name}</option>)}</select></label>
          <label>Routing key<input value={routingKey} onChange={(event) => setRoutingKey(event.target.value)} placeholder="orders.created" /></label>
          <label>Arguments JSON <span className="optional">(optional)</span><input value={bindingArguments} onChange={(event) => setBindingArguments(event.target.value)} placeholder='{"x-match":"all"}' /></label>
          <div className="form-actions"><button className="primary" type="submit" disabled={busy !== "" || !bindingExchange || !bindingQueue}><Plus size={14} /> {busy === "binding" ? "Binding…" : "Create binding"}</button></div>
        </form>
      </Panel>

      <Panel title="Bindings" subtitle={`${bindings.length} routing relationship(s)`}>
        <div className="tablewrap"><table><thead><tr><th>Exchange</th><th>Routing key</th><th>Queue</th><th>Actions</th></tr></thead><tbody>
          {bindings.map((binding) => <tr key={binding.id}><td>{binding.exchangeName}</td><td><code>{binding.routingKey || "(empty)"}</code></td><td><b>{binding.queueName}</b></td><td><button className="icon-action danger-action" title="Remove binding" onClick={() => void handleDeleteBinding({ exchangeName: binding.exchangeName, queueName: binding.queueName, routingKey: binding.routingKey })} disabled={busy !== ""}><Trash2 size={14} /></button></td></tr>)}
          {!bindings.length && <tr><td colSpan={4} className="empty">No bindings found.</td></tr>}
        </tbody></table></div>
      </Panel>

      <Panel title="Publish message" subtitle="Send a JSON message through an exchange and inspect how many queues received it.">
        <form className="management-form" onSubmit={(event) => void handlePublish(event)}>
          <label>Exchange<select required value={publishExchange} onChange={(event) => setPublishExchange(event.target.value)}><option value="">Select exchange</option>{exchanges.map((exchange) => <option key={exchange.id} value={exchange.name}>{exchange.name} ({exchange.type})</option>)}</select></label>
          <label>Routing key<input value={publishRoutingKey} onChange={(event) => setPublishRoutingKey(event.target.value)} placeholder="orders.created" /></label>
          <label className="form-wide">Message JSON<textarea required rows={5} value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} /></label>
          <label className="form-wide">Headers JSON <span className="optional">(optional)</span><textarea rows={3} value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder='{"event":"order.created"}' spellCheck={false} /></label>
          <div className="form-actions"><button className="primary" type="submit" disabled={busy !== "" || !publishExchange}><Send size={14} /> {busy === "publish" ? "Publishing…" : "Publish message"}</button></div>
        </form>
      </Panel>
    </div>
  );
}
