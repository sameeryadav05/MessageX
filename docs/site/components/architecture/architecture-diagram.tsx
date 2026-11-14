'use client';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';

type Kind = 'client' | 'transport' | 'core' | 'storage' | 'operations';
type Data = { title: string; detail: string; kind: Kind };

const palette: Record<Kind, string> = {
  client: 'border-sky-500/70 bg-sky-500/10',
  transport: 'border-violet-500/70 bg-violet-500/10',
  core: 'border-indigo-500/70 bg-indigo-500/10',
  storage: 'border-emerald-500/70 bg-emerald-500/10',
  operations: 'border-amber-500/70 bg-amber-500/10',
};

function ServiceNode({ data }: NodeProps<Node<Data>>) {
  return (
    <div className={`w-[218px] rounded-xl border px-4 py-3 shadow-lg shadow-black/10 ${palette[data.kind]}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-fd-muted-foreground" />
      <p className="text-[13px] font-bold leading-5 text-fd-foreground">{data.title}</p>
      <p className="mt-1 text-[11px] leading-[1.55] text-fd-muted-foreground">{data.detail}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-fd-muted-foreground" />
    </div>
  );
}

const nodeTypes = { service: ServiceNode };
const node = (id: string, x: number, y: number, title: string, detail: string, kind: Kind): Node<Data> => ({
  id, type: 'service', position: { x, y }, data: { title, detail, kind },
});
const edge = (id: string, source: string, target: string, label?: string): Edge => ({
  id, source, target, label, type: 'smoothstep',
  animated: false,
  style: { strokeWidth: 1.8 },
  labelStyle: { fontSize: 11, fontWeight: 650 },
  labelBgStyle: { fill: 'var(--color-fd-card)', fillOpacity: 0.96 },
});

const systemNodes: Node<Data>[] = [
  node('producer', 0, 20, 'Producer application', 'Publishes a JSON message using the Node.js SDK', 'client'),
  node('consumer', 0, 250, 'Consumer application', 'Subscribes and settles deliveries with ACK or NACK', 'client'),
  node('sdk', 280, 20, 'JavaScript SDK', 'TCP socket, frame encoding, request IDs and callbacks', 'client'),
  node('tcp', 560, 20, 'TCP connection layer', 'Accepts sockets and tracks client connection lifecycle', 'transport'),
  node('protocol', 840, 20, 'Protocol + authentication', 'Decodes frames, validates commands and authenticates users', 'transport'),
  node('commands', 1120, 20, 'Command handlers', 'CONNECT, AUTH, queue, exchange, publish and consumer commands', 'core'),
  node('routing', 840, 250, 'Exchange routing', 'Direct, fanout, topic and headers binding matching', 'core'),
  node('delivery', 1120, 250, 'Queue + consumer manager', 'Claims messages, dispatches deliveries and tracks prefetch', 'core'),
  node('postgres', 1400, 135, 'PostgreSQL', 'Persists queues, exchanges, bindings, sessions and message state', 'storage'),
  node('dashboard', 0, 480, 'Management dashboard', 'Browser interface for broker administration and monitoring', 'operations'),
  node('http', 560, 480, 'Management HTTP API', 'Authenticated REST endpoints and health checks', 'operations'),
  node('launcher', 1120, 480, 'Docker launcher', 'Creates and supervises broker, dashboard and database containers', 'operations'),
];
const systemEdges: Edge[] = [
  edge('s1', 'producer', 'sdk'), edge('s2', 'sdk', 'tcp'), edge('s3', 'tcp', 'protocol'),
  edge('s4', 'protocol', 'commands'), edge('s5', 'commands', 'routing'), edge('s6', 'routing', 'delivery'),
  edge('s7', 'delivery', 'postgres', 'claim / persist'), edge('s8', 'consumer', 'sdk'),
  edge('s9', 'dashboard', 'http', 'HTTPS / HTTP'), edge('s10', 'http', 'postgres', 'SQL'),
  edge('s11', 'launcher', 'postgres', 'Docker lifecycle'),
];

const brokerNodes: Node<Data>[] = [
  node('socket', 0, 40, 'TCP socket', 'Receives arbitrary byte chunks from a client', 'transport'),
  node('connection', 280, 40, 'ClientConnection', 'Owns decoder, socket lifecycle and authenticated identity', 'transport'),
  node('frame', 560, 40, 'Frame decoder', 'Reads 4-byte big-endian length and reassembles payload bytes', 'transport'),
  node('parser', 840, 40, 'Protocol parser', 'Parses JSON and validates the v1 Zod schema', 'transport'),
  node('auth', 1120, 40, 'CONNECT → AUTH', 'Registers client name, then verifies broker credentials', 'core'),
  node('dispatch', 1400, 40, 'Command dispatcher', 'Checks authentication and invokes the matching handler', 'core'),
  node('publish', 560, 280, 'Publish + routing', 'Resolves exchange bindings and inserts one record per target queue', 'core'),
  node('consume', 840, 280, 'Consumer manager', 'Schedules eligible consumers and claims ready messages', 'core'),
  node('settle', 1120, 280, 'ACK / NACK', 'Checks delivery ownership, retry limit and dead-letter policy', 'core'),
  node('repositories', 1400, 280, 'Repositories', 'Transactions and guarded message state transitions', 'storage'),
  node('db', 1400, 500, 'PostgreSQL', 'Durable broker records and delivery state', 'storage'),
];
const brokerEdges: Edge[] = [
  edge('b1', 'socket', 'connection'), edge('b2', 'connection', 'frame'), edge('b3', 'frame', 'parser'),
  edge('b4', 'parser', 'auth'), edge('b5', 'auth', 'dispatch'), edge('b6', 'dispatch', 'publish'),
  edge('b7', 'dispatch', 'consume'), edge('b8', 'dispatch', 'settle'),
  edge('b9', 'publish', 'repositories'), edge('b10', 'consume', 'repositories'),
  edge('b11', 'settle', 'repositories'), edge('b12', 'repositories', 'db'),
];

const lifecycleNodes: Node<Data>[] = [
  node('publisher', 0, 40, '1 · Producer publishes', 'client.publish() sends exchange, routing key, body and headers', 'client'),
  node('exchange', 300, 40, '2 · Exchange routes', 'Bindings are evaluated using direct, fanout, topic or headers rules', 'core'),
  node('store', 600, 40, '3 · Persist message', 'A PostgreSQL transaction inserts a message for each matched queue', 'storage'),
  node('claim', 900, 40, '4 · Consumer claims', 'A ready row is claimed with FOR UPDATE SKIP LOCKED', 'core'),
  node('deliver', 900, 280, '5 · Deliver event', 'Broker sends MESSAGE_DELIVERED with deliveryTag and message body', 'transport'),
  node('handler', 600, 280, '6 · Application processes', 'Consumer callback performs work before settling the delivery', 'client'),
  node('ack', 300, 280, '7A · ACK', 'Valid owner + deliveryTag removes the acknowledged message record', 'storage'),
  node('nack', 0, 280, '7B · NACK', 'Requeue, dead-letter after max deliveries, mark dead, or discard', 'core'),
];
const lifecycleEdges: Edge[] = [
  edge('l1', 'publisher', 'exchange'), edge('l2', 'exchange', 'store'), edge('l3', 'store', 'claim'),
  edge('l4', 'claim', 'deliver'), edge('l5', 'deliver', 'handler'),
  edge('l6', 'handler', 'ack', 'success'), edge('l7', 'handler', 'nack', 'failure'),
];

const diagrams = {
  system: { nodes: systemNodes, edges: systemEdges, title: 'MessageX system map', hint: 'Follow each lane from client traffic to persistence and operations.' },
  broker: { nodes: brokerNodes, edges: brokerEdges, title: 'Inside the broker', hint: 'The TCP command path converges on repositories and PostgreSQL.' },
  lifecycle: { nodes: lifecycleNodes, edges: lifecycleEdges, title: 'Message delivery, step by step', hint: 'A consumer must explicitly ACK or NACK each delivery.' },
};

export function ArchitectureDiagram({ variant = 'system' }: { variant?: keyof typeof diagrams }) {
  const diagram = diagrams[variant];
  return (
    <section className="my-9">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fd-foreground">{diagram.title}</p>
          <p className="mt-1 text-xs text-fd-muted-foreground">{diagram.hint}</p>
        </div>
        <span className="rounded-full border border-fd-border bg-fd-muted px-3 py-1 text-[11px] font-medium text-fd-muted-foreground">Interactive · zoom · drag</span>
      </div>
      <div className="messagex-flow">
        <ReactFlow
          nodes={diagram.nodes}
          edges={diagram.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.42, maxZoom: 0.9 }}
          minZoom={0.3}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-fd-muted-foreground)" gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="mt-3 text-xs leading-5 text-fd-muted-foreground">Conceptual map of the current implementation. Use the linked source files in each guide for exact validation rules and runtime behavior.</p>
    </section>
  );
}
