# MessageX Documentation Site

The documentation website is an independent **Next.js + Fumadocs** application. It lives in `docs/site` so documentation dependencies and scripts remain isolated from the broker, dashboard, and JavaScript SDK workspaces.

## Requirements

- Node.js 22 or newer
- npm
- Git (to work with the repository)

## Run locally

From the repository root:

```bash
cd docs/site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The first install runs the `fumadocs-mdx` postinstall script and generates the local `.source` types used by the content loader.

## Validate a change

Run these commands from `docs/site`:

```bash
npm run typecheck
npm run build
npm run start
```

- `dev` starts the Next.js development server.
- `typecheck` runs TypeScript without emitting files.
- `build` creates the production Next.js build.
- `start` serves the production build.

## Project structure

```text
docs/
├── assets/                  # Existing repository documentation assets
└── site/
    ├── app/                 # Next.js routes, layouts, and global styles
    ├── components/          # Reusable UI and interactive diagrams
    ├── content/docs/        # Fumadocs MDX pages and sidebar metadata
    ├── lib/                 # Fumadocs source and shared layout options
    ├── public/brand/        # Static brand assets served by Next.js
    ├── mdx-components.tsx   # MDX component registry
    ├── source.config.ts     # Fumadocs content source configuration
    └── package.json         # Isolated documentation dependencies
```

## Add or organize documentation

1. Create an `.mdx` page inside the appropriate folder under `content/docs`.
2. Add frontmatter with at least a `title` and a short `description`.
3. Add the page slug to that folder's `meta.json` so it appears in the intended sidebar order.
4. Use the existing Fumadocs components for callouts, tabs, code blocks, and other documentation UI.
5. Run `npm run typecheck` and `npm run build` before committing.

The numbered folder titles (for example, `01 · Getting Started` and `02 · Architecture`) establish the progression shown in the left navigation. Keep the ordering intentional as new sections are added.

## Architecture diagrams

Interactive React Flow diagrams are implemented in `components/architecture/architecture-diagram.tsx` and exposed to MDX through `mdx-components.tsx`.

Current variants:

- `system` — platform-level services and communication paths
- `broker` — broker request pipeline
- `lifecycle` — publish, route, deliver, and settle flow

When implementation details change, update the diagram and its accompanying explanation together. Treat the repository source as authoritative.

## Theme and visual system

The site uses Fumadocs' shadcn-style theme tokens and Tailwind CSS 4. The root provider defaults to dark mode; the documentation layout exposes the light/dark theme switch. Prefer Fumadocs theme variables such as `fd-card`, `fd-border`, and `fd-muted-foreground` over hard-coded colors so pages remain readable in both themes.

## Keep documentation work isolated

- Put documentation website code and MDX content inside `docs/site`.
- Keep existing files in `docs/assets`; do not move or overwrite them as part of routine site work.
- Do not add the docs app to the root npm workspaces unless that architecture is deliberately changed.
- Avoid changes to the root `package.json` and root lockfile for docs-only dependency work.
- Do not commit `.env`, `node_modules`, `.next`, or generated `.source` files.
