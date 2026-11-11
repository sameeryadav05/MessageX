<div align="center">

<img src="./docs/assets/messagex-logo.svg" alt="MessageX — Self-hosted Message Broker" width="680" />

### A self-hosted message broker platform built for developers who want control of their infrastructure.

[![Launcher](https://img.shields.io/badge/Docker-Launcher-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/sameeryadav2005/messagex-v2)
[![Broker](https://img.shields.io/badge/Broker-0.1.1-7C3AED)](https://hub.docker.com/r/sameeryadav2005/messagex-broker-v2)
[![Dashboard](https://img.shields.io/badge/Dashboard-0.1.4-6366F1)](https://hub.docker.com/r/sameeryadav2005/messagex-dashboard-v2)
[![npm](https://img.shields.io/badge/SDK-messagex--client-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/messagex-client)
[![TypeScript](https://img.shields.io/badge/TypeScript-First-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Quick Start](#quick-start) · [Architecture](#architecture) · [Internals](#how-messagex-works) · [SDK](#javascript--typescript-sdk) · [Deployment](#deployment) · [Roadmap](#roadmap)

</div>

---

## What is MessageX?

**MessageX** is a self-hosted message broker platform for asynchronous communication between services and applications. It combines a TCP-based broker, a browser-based management dashboard, PostgreSQL persistence, Docker deployment, and an official Node.js SDK with TypeScript declarations.

Instead of depending on a hosted messaging provider, teams can run MessageX on infrastructure they control. Applications connect through the client SDK, publish messages to exchanges, route them to queues, and consume them with explicit acknowledgement control.

The project is developed as an end-to-end messaging system: transport, wire protocol, broker command processing, routing, delivery reliability, persistence, management APIs, dashboard, SDK, and deployment tooling.

## Why MessageX?

- **Self-hosted:** Run the broker on your own machine, VM, or cloud infrastructure.
- **Developer API:** Work with queues, exchanges, bindings, publishing, consumers, ACK, and NACK.
- **Operational visibility:** Manage broker resources through a web dashboard.
- **Persistent storage:** Store broker state and messages using PostgreSQL.
- **Containerized deployment:** Start the complete platform using Docker.
- **TypeScript-first development:** The broker and official JavaScript SDK are implemented in TypeScript.

## Platform at a glance

| Component | Responsibility | Default endpoint |
|---|---|---|
| MessageX Broker | TCP connections, protocol, routing, queues, delivery | localhost:5678 |
| Management API | Dashboard-facing HTTP operations and health checks | Internal :3000 |
| Dashboard | Browser-based broker management | http://localhost:15672 |
| PostgreSQL | Persistent broker data | Internal :5432 |
| JavaScript / TypeScript SDK | Application integration over TCP | Broker :5678 |
| Launcher | Provisions and supervises Docker deployment | Docker container |

---

## Quick Start

The recommended way to run MessageX is with the Launcher image. It provisions the broker, dashboard, PostgreSQL, networking, and initial administrator account.

### Requirements

- Docker Engine or Docker Desktop.
- Internet access to pull images.
- Host ports 5678/TCP and 15672/HTTP available by default.
- For a small evaluation deployment, allow at least 2 GB RAM and 2 vCPUs.

### Start MessageX

~~~bash
docker run -d \
  --name messagex \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v messagex_launcher_data:/data \
  sameeryadav2005/messagex-v2:0.1.8
~~~

The launcher pulls the broker and dashboard images, creates a private Docker network, provisions PostgreSQL, initializes the administrator account, and starts the services.

### Access the platform

| Service | Address |
|---|---|
| Dashboard | http://localhost:15672 |
| Broker TCP endpoint | localhost:5678 |

If credentials are generated automatically, retrieve them with:

~~~bash
docker exec messagex cat /data/credentials.txt
~~~

### Set administrator credentials on first startup

For a new installation, supply both variables:

~~~bash
docker run -d \
  --name messagex \
  --restart unless-stopped \
  -e MESSAGEX_DEFAULT_USER=admin \
  -e MESSAGEX_DEFAULT_PASS='ReplaceWithA_StrongPassword123' \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v messagex_launcher_data:/data \
  sameeryadav2005/messagex-v2:0.1.8
~~~

The password must be at least 12 characters. These variables initialize credentials only on first startup; they do not reset an existing account.

> **Privilege note:** The launcher mounts the Docker socket to manage its child containers. Treat it as a privileged component and run it only on a machine you trust.

---

## Architecture

MessageX is divided into components with clear responsibilities. The broker owns the messaging data path; the dashboard uses the broker's management HTTP API; SDK clients use the broker's TCP protocol; PostgreSQL provides persistence.

~~~mermaid
flowchart TB
    subgraph Clients["APPLICATIONS"]
        JS["JavaScript / TypeScript SDK"]
        Other["Other TCP clients"]
    end

    subgraph Platform["MESSAGEX PLATFORM · DOCKER NETWORK"]
        subgraph Broker["MESSAGE BROKER"]
            TCP["TCP Listener · 5678"]
            Conn["Connection Manager"]
            Protocol["Frame Decoder · Protocol Validation"]
            Auth["Authentication"]
            Dispatch["Command Dispatcher"]
            Publish["Publish Handler"]
            Exchange["Exchange Router"]
            Queue["Queue Manager"]
            Consumer["Consumer Manager"]
            Delivery["Delivery Engine"]
            Ack["ACK / NACK · Retry / Requeue"]
        end
        API["Management HTTP API · 3000"]
        UI["Dashboard · React / Nginx"]
        DB[("PostgreSQL · 5432")]
    end

    JS --> TCP
    Other --> TCP
    TCP --> Conn --> Protocol --> Auth --> Dispatch
    Dispatch --> Publish --> Exchange --> Queue
    Queue --> Consumer --> Delivery --> Ack
    Ack <--> DB
    Queue <--> DB
    Exchange <--> DB
    UI --> API
    API <--> Broker
~~~

### Component responsibilities

| Component | Responsibility |
|---|---|
| **TCP / Transport Layer** | Accepts client TCP sockets, tracks active connections, and handles connection lifecycle. |
| **Protocol Layer** | Decodes frames, validates protocol messages, and correlates requests and responses. |
| **Authentication** | Authenticates client credentials before broker operations are allowed. |
| **Command Handler** | Dispatches validated commands to queue, exchange, publish, consume, and acknowledgement logic. |
| **Exchange Router** | Routes messages according to exchange type, routing key, and binding arguments. |
| **Queue Manager** | Declares, deletes, and manages queue configuration and stored messages. |
| **Consumer Manager** | Registers consumers and coordinates message delivery for active connections. |
| **Delivery / Reliability** | Tracks deliveries and supports ACK, NACK, requeue, delivery recovery, and configured dead-letter behavior. |
| **PostgreSQL Layer** | Persists broker state and message data; migrations run during broker startup. |
| **Management API** | Exposes HTTP management operations and health endpoints for the dashboard. |
| **Dashboard** | Provides the browser interface for inspecting and managing broker resources. |
| **Launcher** | Creates and supervises Docker containers, network, and persistent storage. |

---

## How MessageX Works

### 1. Connection and authentication

An application creates an SDK client with the broker hostname, TCP port, username, and password. The SDK opens a TCP socket and performs the protocol connection and authentication handshake.

The broker accepts the connection, creates a client connection context, and registers it with the connection manager. Commands are processed after successful authentication.

### 2. Framing and protocol processing

MessageX uses a custom versioned binary frame protocol over TCP. The client and broker encode and decode frames, validate protocol messages, and use request identifiers to match responses with outstanding operations.

The current protocol version 1 command set includes:

- CONNECT and AUTH
- QUEUE_DECLARE and QUEUE_DELETE
- EXCHANGE_DECLARE and EXCHANGE_DELETE
- BIND and UNBIND
- PUBLISH and CONSUME
- ACK, NACK, and CANCEL

### 3. Exchanges, bindings, and routing

A producer publishes a message to an exchange with a routing key and optional headers. Bindings connect exchanges to queues and define routing relationships. The exchange router evaluates those bindings and determines which queues receive the message.

| Exchange type | Routing behavior |
|---|---|
| **Direct** | Routes using an exact routing-key match. |
| **Fanout** | Routes to all queues bound to the exchange. |
| **Topic** | Routes using topic-pattern matching. |
| **Headers** | Routes using binding arguments and message headers. |

### 4. Queue storage and consumer delivery

Messages routed to queues are stored through the broker's persistence layer. Consumers subscribe to queues and receive deliveries over their TCP connection.

The initial SDK uses a prefetch count of 1 per consumer connection. Applications should explicitly settle each delivery.

### 5. Acknowledgement and recovery

After processing a message, a consumer can:

- **ACK:** confirm successful processing.
- **NACK with requeue:** reject the delivery and request redelivery.
- **NACK without requeue:** reject without requesting requeue.

The broker tracks deliveries and supports recovery when a consumer connection closes or an acknowledgement timeout expires. Queue configuration also supports a maximum delivery count and a dead-letter queue.

### 6. Dashboard and management API

The dashboard is a React application served by Nginx. Nginx serves the frontend and forwards API and health requests to the broker's internal management API at broker:3000.

This keeps the management API and PostgreSQL on the Docker network rather than requiring public ports for them.

---

## Technology Stack

| Area | Technologies |
|---|---|
| Broker runtime | Node.js, TypeScript |
| Network transport | Node.js TCP sockets |
| Wire protocol | Custom versioned binary framing and protocol messages |
| Broker API | Node.js, Express, HTTP |
| Database | PostgreSQL, SQL migrations |
| Database access | pg connection pool |
| Dashboard | React 19, TypeScript, Vite |
| Dashboard web server | Nginx |
| SDK | TypeScript, Node.js TCP sockets, ESM |
| SDK packaging | npm, TypeScript declaration files |
| Containerization | Docker, Docker Compose |
| Testing | Node.js test runner, TypeScript checks, broker and SDK tests |
| CI | GitHub Actions |

---

## JavaScript & TypeScript SDK

The official Node.js SDK is published on npm as **[messagex-client](https://www.npmjs.com/package/messagex-client)**.

~~~bash
npm install messagex-client
~~~

The package supports JavaScript ES modules and TypeScript projects. Type declarations are included.

### Connect to a broker

~~~typescript
import { MessageX } from "messagex-client";

const client = new MessageX({
  host: "localhost",
  port: 5678,
  username: process.env.MESSAGEX_USER!,
  password: process.env.MESSAGEX_PASSWORD!
});

await client.connect();
console.log("Connected to MessageX");
~~~

### Declare, bind, and publish

~~~typescript
await client.exchange.declare({
  name: "orders.exchange",
  type: "direct",
  durable: true
});

await client.queue.declare({
  name: "orders",
  durable: true
});

await client.exchange.bind({
  exchangeName: "orders.exchange",
  queueName: "orders",
  routingKey: "orders.created"
});

await client.publish({
  exchangeName: "orders.exchange",
  routingKey: "orders.created",
  message: {
    orderId: "ORD-1001",
    status: "created"
  }
});
~~~

### Consume and acknowledge

~~~typescript
const subscription = await client.consume({
  queueName: "orders",
  onMessage: async (message) => {
    try {
      console.log("Received:", message.body);
      await message.ack();
    } catch (error) {
      console.error("Processing failed:", error);
      await message.nack({ requeue: true });
    }
  }
});

// Graceful shutdown
await subscription.cancel();
await client.close();
~~~

SDK resources:

- [npm package](https://www.npmjs.com/package/messagex-client)
- [SDK README](./packages/javascript-sdk/README.md)
- [SDK source](./packages/javascript-sdk)
- [Real broker integration example](./packages/javascript-sdk/examples/real-broker-test.mjs)

> **SDK scope:** The current package is a Node.js SDK that works in JavaScript and TypeScript. It is not a browser SDK. Python and Java SDKs are planned, not yet published.

---

## Docker Images

MessageX publishes three Docker images. The Launcher is the recommended entry point for a complete installation.

| Image | Purpose | Current tag |
|---|---|---|
| [messagex-v2](https://hub.docker.com/r/sameeryadav2005/messagex-v2) | Full-stack launcher | 0.1.8 |
| [messagex-broker-v2](https://hub.docker.com/r/sameeryadav2005/messagex-broker-v2) | Broker server | 0.1.1 |
| [messagex-dashboard-v2](https://hub.docker.com/r/sameeryadav2005/messagex-dashboard-v2) | Web management UI | 0.1.4 |

~~~bash
docker pull sameeryadav2005/messagex-v2:0.1.8
docker pull sameeryadav2005/messagex-broker-v2:0.1.1
docker pull sameeryadav2005/messagex-dashboard-v2:0.1.4
~~~

### Launcher configuration

| Variable | Default | Purpose |
|---|---:|---|
| MESSAGEX_DEFAULT_USER | admin | Initial administrator username |
| MESSAGEX_DEFAULT_PASS | Generated | Initial administrator password |
| TCP_PORT | 5678 | Host port for broker TCP |
| DASHBOARD_PORT | 15672 | Host port for dashboard HTTP |
| TCP_BIND_ADDRESS | 0.0.0.0 | Broker host bind address |
| MESSAGEX_BROKER_VERSION | 0.1.1 | Broker image tag |
| MESSAGEX_DASHBOARD_VERSION | 0.1.4 | Dashboard image tag |

The host ports can be customized without changing internal container ports.

---

## Run from Source

### Requirements

- Node.js 20 or newer (container builds use Node.js 22).
- npm.
- Docker Engine and Docker Compose.
- PostgreSQL for running the broker outside Docker.

### Clone and install

~~~bash
git clone https://github.com/sameeryadav05/MessageX.git
cd MessageX
npm install
~~~

### Run development services

~~~bash
npm run dev:broker
npm run dev:dashboard
~~~

Configure PostgreSQL and set DATABASE_URL before starting the broker.

### Build components

~~~bash
npm run build:broker
npm run build:dashboard
npm run build:sdk
~~~

### Run tests

~~~bash
npm run test:broker
npm run test:sdk
~~~

### Deploy using published Docker images

Create a .env file based on [.env.compose.example](./.env.compose.example), then run:

~~~bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
docker compose -f docker-compose.hub.yml ps
~~~

---

## Network and Security

| Port | Service | Exposure |
|---:|---|---|
| 5678/TCP | Broker client protocol | Published for SDK/client access |
| 15672/HTTP | Dashboard | Published for browser access |
| 3000/HTTP | Broker management API | Internal Docker network |
| 5432/TCP | PostgreSQL | Internal Docker network |

**Security considerations**

- The current TCP protocol and dashboard HTTP endpoint do not provide TLS encryption.
- Do not send credentials or messages over untrusted networks.
- Restrict inbound access to ports 5678 and 15672 using host/cloud firewalls.
- Keep management API port 3000 and PostgreSQL port 5432 private.
- Protect the Docker socket and persistent volumes.
- Use strong, unique database and administrator passwords.

For remote deployments, prefer a trusted private network, VPN, or SSH tunnel for broker access.

---

## Roadmap

The project is being developed incrementally. Planned areas include:

- Expand SDK support beyond Node.js.
- Improve broker observability and operational metrics.
- Continue strengthening delivery reliability and failure handling.
- Expand integration and end-to-end test coverage.
- Improve deployment and developer documentation.

Roadmap items are goals, not claims that those features are already available.

## Contributing

Contributions, bug reports, and technical feedback are welcome.

1. Fork the repository.
2. Create a focused feature branch.
3. Add or update tests for behavior changes.
4. Run the relevant build and test commands.
5. Open a pull request with a clear description of the change.

Please include reproduction steps for bugs and describe any protocol or compatibility changes.

## Project Links

- **GitHub:** [sameeryadav05/MessageX](https://github.com/sameeryadav05/MessageX)
- **Docker Hub — Launcher:** [messagex-v2](https://hub.docker.com/r/sameeryadav2005/messagex-v2)
- **Docker Hub — Broker:** [messagex-broker-v2](https://hub.docker.com/r/sameeryadav2005/messagex-broker-v2)
- **Docker Hub — Dashboard:** [messagex-dashboard-v2](https://hub.docker.com/r/sameeryadav2005/messagex-dashboard-v2)
- **npm — JavaScript / TypeScript SDK:** [messagex-client](https://www.npmjs.com/package/messagex-client)
- **SDK Documentation:** [packages/javascript-sdk](./packages/javascript-sdk)

---

<div align="center">

### MessageX

**Your infrastructure. Your messages. Your control.**

Built with TypeScript · Node.js · PostgreSQL · React · Docker

</div>
