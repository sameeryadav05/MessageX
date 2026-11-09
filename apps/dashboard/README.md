# MessageX Management Dashboard

RabbitMQ-inspired React + TypeScript management UI.

## Install
1. Extract this ZIP.
2. Copy the contents of `messagex-dashboard` into your existing `MessageX/apps/dashboard` folder.
3. Replace that folder's placeholder `package.json` if prompted. Do NOT replace the root `MessageX/package.json`.
4. From the MessageX repository root run:

```bash
npm install
npm run dev:dashboard
```

5. Keep the broker running in another terminal with `npm run dev:broker`.
6. Open http://localhost:5173.

Vite proxies `/api/*` and `/health` to `http://127.0.0.1:3000`.
Pages: Overview, Queues, Exchanges & Bindings, Connections, Monitoring.
Data refreshes every 3–5 seconds. This first version is read-only.
