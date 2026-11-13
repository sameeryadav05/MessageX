/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';

type NodeData = {
  title: string;
  detail: string;
  kind?: 'client' | 'transport' | 'core' | 'storage' | 'operations';
};

function ServiceNode({ data }: NodeProps<Node<NodeData>>) {
  const accents: Record<NonNullable<NodeData['kind']>, string> = {
    client: 'border-sky-500/50',
    transport: 'border-violet-500/50',
    core: 'border-indigo-500/50',
    storage: 'border-emerald-500/50',
    operations: 'border-amber-500/50',
  };

  return (
    <div className={`min-w-44 rounded-xl border bg-[var(--color-fd-card)] px-4 py-3 shadow-lg ${accents[data.kind ?? 'core']}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-fd-muted-foreground" />
      <div className="text-sm font-semibold text-fd-foreground">{data.title}</div>
      <div className="mt-1 max-w-52 text-xs leading-relaxed text-fd-muted-foreground">{data.detail}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-fd-muted-foreground" />
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

const systemNodes: Node<NodeData>[] = [
  { id: 'apps', type: 'service', position: { x: 0, y: 160 }, data: { title: 'Applications', detail: 'Producer and consumer services', kind: 'client' } },
  { id: 'sdk', type: 'service', position: { x: 220, y: 160 }, data: { title: 'JavaScript SDK', detail: 'TCP client, framing and request correlation', kind: 'client' } },
  { id: 'tcp', type: 'service', position: { x: 470, y: 160 }, data: { title: 'TCP listener', detail: 'Accepts client sockets and manages connections', kind: 'transport' } },
  { id: 'protocol', type: 'service', position: { x: 710, y: 160 }, data: { title: 'Protocol layer', detail: 'Frame decode, parse and schema validation', kind: 'transport' } },
  { id: 'auth', type: 'service', position: { x: 950, y: 160 }, data: { title: 'Authentication', detail: 'Verifies client credentials', kind: 'core' } },
  { id: 'commands', type: 'service', position: { x: 1190, y: 160 }, data: { title: 'Command handlers', detail: 'Queue, exchange, publish, consume and ACK/NACK', kind: 'core' } },
  { id: 'routing', type: 'service', position: { x: 1440, y: 40 }, data: { title: 'Routing engine', detail: 'Matches exchange type, key and bindings', kind: 'core' } },
  { id: 'queues', type: 'service', position: { x: 1440, y: 260 }, data: { title: 'Queue / consumer manager', detail: 'Stores queued messages and coordinates delivery', kind: 'core' } },
  { id: 'db', type: 'service', position: { x: 1700, y: 150 }, data: { title: 'PostgreSQL', detail: 'Persistent broker state and message records', kind: 'storage' } },
  { id: 'api', type: 'service', position: { x: 950, y: 440 }, data: { title: 'Management API', detail: 'HTTP operations and health endpoints', kind: 'operations' } },
  { id: 'dashboard', type: 'service', position: { x: 1190, y: 440 }, data: { title: 'Dashboard', detail: 'Browser-based broker administration', kind: 'operations' } },
  { id: 'launcher', type: 'service', position: { x: 1440, y: 560 }, data: { title: 'Launcher', detail: 'Provisions and supervises Docker services', kind: 'operations' } },
];

const systemEdges: Edge[] = [
  { id: 'e1', source: 'apps', target: 'sdk', animated: true },
  { id: 'e2', source: 'sdk', target: 'tcp', animated: true },
  { id: 'e3', source: 'tcp', target: 'protocol' },
  { id: 'e4', source: 'protocol', target: 'auth' },
  { id: 'e5', source: 'auth', target: 'commands' },
  { id: 'e6', source: 'commands', target: 'routing' },
  { id: 'e7', source: 'commands', target: 'queues' },
  { id: 'e8', source: 'routing', target: 'db' },
  { id: 'e9', source: 'queues', target: 'db' },
  { id: 'e10', source: 'dashboard', target: 'api', label: 'HTTP' },
  { id: 'e11', source: 'api', target: 'db', label: 'repositories / SQL' },
  { id: 'e12', source: 'launcher', target: 'dashboard', label: 'Docker' },
];

const brokerNodes: Node<NodeData>[] = [
  { id: 'socket', type: 'service', position: { x: 0, y: 180 }, data: { title: 'TCP socket', detail: 'Incoming byte stream', kind: 'transport' } },
  { id: 'connection', type: 'service', position: { x: 220, y: 180 }, data: { title: 'Connection manager', detail: 'ClientConnection lifecycle and socket events', kind: 'transport' } },
  { id: 'decoder', type: 'service', position: { x: 460, y: 180 }, data: { title: 'Frame decoder', detail: 'Reassembles and decodes protocol frames', kind: 'transport' } },
  { id: 'parser', type: 'service', position: { x: 700, y: 180 }, data: { title: 'Protocol parser', detail: 'Parses command and validates its schema', kind: 'transport' } },
  { id: 'authn', type: 'service', position: { x: 940, y: 180 }, data: { title: 'Auth handler', detail: 'CONNECT and AUTH flow', kind: 'core' } },
  { id: 'dispatch', type: 'service', position: { x: 1180, y: 180 }, data: { title: 'Command dispatch', detail: 'Selects a command handler', kind: 'core' } },
  { id: 'publish', type: 'service', position: { x: 1440, y: 20 }, data: { title: 'Publish / routing', detail: 'Exchange lookup, bindings and destination queues', kind: 'core' } },
  { id: 'consume', type: 'service', position: { x: 1440, y: 230 }, data: { title: 'Consumer manager', detail: 'Subscriptions, availability and dispatch', kind: 'core' } },
  { id: 'ack', type: 'service', position: { x: 1440, y: 440 }, data: { title: 'Delivery settlement', detail: 'ACK, NACK, requeue and recovery paths', kind: 'core' } },
  { id: 'repository', type: 'service', position: { x: 1720, y: 230 }, data: { title: 'Repositories', detail: 'Persistence boundary for broker state', kind: 'storage' } },
  { id: 'postgres', type: 'service', position: { x: 1960, y: 230 }, data: { title: 'PostgreSQL', detail: 'Durable records and queued messages', kind: 'storage' } },
];

const brokerEdges: Edge[] = [
  { id: 'b1', source: 'socket', target: 'connection' },
  { id: 'b2', source: 'connection', target: 'decoder' },
  { id: 'b3', source: 'decoder', target: 'parser' },
  { id: 'b4', source: 'parser', target: 'authn' },
  { id: 'b5', source: 'authn', target: 'dispatch' },
  { id: 'b6', source: 'dispatch', target: 'publish' },
  { id: 'b7', source: 'dispatch', target: 'consume' },
  { id: 'b8', source: 'dispatch', target: 'ack' },
  { id: 'b9', source: 'publish', target: 'repository' },
  { id: 'b10', source: 'consume', target: 'repository' },
  { id: 'b11', source: 'ack', target: 'repository' },
  { id: 'b12', source: 'repository', target: 'postgres' },
];

const lifecycleNodes: Node<NodeData>[] = [
  { id: 'producer', type: 'service', position: { x: 0, y: 180 }, data: { title: 'Producer', detail: 'Calls client.publish()', kind: 'client' } },
  { id: 'publish-handler', type: 'service', position: { x: 240, y: 180 }, data: { title: 'Publish handler', detail: 'Validates target exchange and payload', kind: 'core' } },
  { id: 'exchange', type: 'service', position: { x: 500, y: 180 }, data: { title: 'Exchange router', detail: 'Finds queue destinations from bindings', kind: 'core' } },
  { id: 'persist', type: 'service', position: { x: 760, y: 180 }, data: { title: 'Persistence', detail: 'Writes routed message records', kind: 'storage' } },
  { id: 'dispatch-message', type: 'service', position: { x: 1020, y: 180 }, data: { title: 'Consumer dispatch', detail: 'Selects an eligible active consumer', kind: 'core' } },
  { id: 'consumer', type: 'service', position: { x: 1280, y: 180 }, data: { title: 'Consumer', detail: 'Processes the delivered body', kind: 'client' } },
  { id: 'settle', type: 'service', position: { x: 1540, y: 180 }, data: { title: 'ACK / NACK', detail: 'Settles or rejects the delivery', kind: 'core' } },
  { id: 'delete', type: 'service', position: { x: 1800, y: 70 }, data: { title: 'ACK', detail: 'Acknowledged message is removed/settled', kind: 'storage' } },
  { id: 'requeue', type: 'service', position: { x: 1800, y: 290 }, data: { title: 'NACK + requeue', detail: 'Message returns to queue for another delivery', kind: 'core' } },
];

const lifecycleEdges: Edge[] = [
  { id: 'l1', source: 'producer', target: 'publish-handler', animated: true },
  { id: 'l2', source: 'publish-handler', target: 'exchange' },
  { id: 'l3', source: 'exchange', target: 'persist' },
  { id: 'l4', source: 'persist', target: 'dispatch-message' },
  { id: 'l5', source: 'dispatch-message', target: 'consumer' },
  { id: 'l6', source: 'consumer', target: 'settle' },
  { id: 'l7', source: 'settle', target: 'delete', label: 'ACK' },
  { id: 'l8', source: 'settle', target: 'requeue', label: 'NACK' },
];

const diagrams = {
  system: { nodes: systemNodes, edges: systemEdges, title: 'MessageX platform' },
  broker: { nodes: brokerNodes, edges: brokerEdges, title: 'Broker request pipeline' },
  lifecycle: { nodes: lifecycleNodes, edges: lifecycleEdges, title: 'Message delivery lifecycle' },
};

export function ArchitectureDiagram({ variant = 'system' }: { variant?: keyof typeof diagrams }) {
  const diagram = diagrams[variant];

  return (
    <section className="my-8">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{diagram.title}</span>
        <span className="text-xs text-fd-muted-foreground">Drag · zoom · pan · inspect</span>
      </div>
      <div className="messagex-flow">
        <ReactFlow
          nodes={diagram.nodes}
          edges={diagram.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-fd-muted-foreground)" gap={20} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>
      <p className="mt-2 text-xs text-fd-muted-foreground">Diagram is an explanatory view of the documented flow. Refer to linked implementation modules for exact runtime details.</p>
    </section>
  );
}
