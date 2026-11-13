# MessageX Documentation Site

Independent Next.js + Fumadocs application. It intentionally lives under `docs/site` and is not part of the root npm workspace.

## Requirements

- Node.js 22 or newer (required by the current Fumadocs quick start)
- npm

## Install and run

```bash
cd docs/site
npm install
npm run dev
```

Open http://localhost:3000.

## Build

```bash
npm run build
```

## Content

Write MDX files under `content/docs`. Sidebar ordering and groups are driven by each folder's `meta.json`.

Existing repository documentation assets remain in `docs/assets`; do not move or overwrite them.
