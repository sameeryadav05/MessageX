import Link from 'next/link';

const journeys = [
  {
    number: '01',
    eyebrow: 'START HERE',
    title: 'Run MessageX',
    description: 'Launch the complete stack with Docker, configure credentials, and connect to your broker.',
    href: '/docs/getting-started/quickstart',
    action: 'Launch your broker',
  },
  {
    number: '02',
    eyebrow: 'UNDER THE HOOD',
    title: 'Understand the system',
    description: 'Follow the TCP protocol, command pipeline, exchange routing, queue delivery, and persistence.',
    href: '/docs/architecture/overview',
    action: 'Explore architecture',
  },
  {
    number: '03',
    eyebrow: 'BUILD WITH IT',
    title: 'Integrate an application',
    description: 'Install the published Node.js client and build a producer and consumer in a few steps.',
    href: '/docs/sdk/javascript',
    action: 'Use the JavaScript SDK',
  },
];

const capabilities = [
  ['TCP protocol', 'Length-prefixed JSON frames over a persistent TCP connection.'],
  ['Exchange routing', 'Direct, fanout, topic, and headers routing strategies.'],
  ['Reliable delivery', 'Explicit ACK/NACK, retry limits, dead-letter routing, and recovery.'],
  ['PostgreSQL storage', 'Persistent queues, exchanges, bindings, and message records.'],
];

export default function Home() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'MessageX',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform',
    description: 'A self-hosted message broker with a TCP protocol, PostgreSQL persistence, Docker deployment, and an official Node.js SDK.',
    url: 'https://messagex.imsameer.me',
    codeRepository: 'https://github.com/sameeryadav05/MessageX',
    softwareHelp: 'https://messagex.imsameer.me/docs',
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-fd-background text-fd-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[620px] bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--color-fd-primary)_17%,transparent),transparent_68%)]" />
      <header className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <img src="/brand/messagex-logo.svg" alt="MessageX" className="h-9 w-auto" />
          <span className="text-sm font-semibold tracking-tight">Documentation</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-fd-muted-foreground">
          <Link className="transition-colors hover:text-fd-foreground" href="/docs">Guides</Link>
          <a className="transition-colors hover:text-fd-foreground" href="https://github.com/sameeryadav05/MessageX">GitHub</a>
          <a className="rounded-lg border border-fd-border bg-fd-card px-4 py-2 font-medium text-fd-foreground transition-colors hover:bg-fd-accent" href="https://www.npmjs.com/package/messagex-client">npm package</a>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:pb-32 lg:pt-24">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/80 px-3 py-1.5 text-xs font-medium text-fd-muted-foreground shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            SELF-HOSTED · OPEN SOURCE · DEVELOPER FIRST
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Messaging infrastructure, <span className="text-fd-primary">made understandable.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
            Run your own message broker. Connect services over TCP. Explore how queues, exchanges,
            routing, persistence, and delivery work — with documentation grounded in the MessageX codebase.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/docs/getting-started/quickstart" className="inline-flex items-center gap-2 rounded-xl bg-fd-primary px-5 py-3 text-sm font-semibold text-fd-primary-foreground shadow-lg shadow-fd-primary/15 transition-transform hover:-translate-y-0.5">
              Get started <span aria-hidden>→</span>
            </Link>
            <Link href="/docs/architecture/overview" className="rounded-xl border border-fd-border bg-fd-card px-5 py-3 text-sm font-semibold transition-colors hover:bg-fd-accent">
              Explore architecture
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-medium text-fd-muted-foreground">
            <span>TypeScript broker</span>
            <span>PostgreSQL persistence</span>
            <span>Docker deployment</span>
            <span>Node.js SDK</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-5 rounded-[2rem] bg-fd-primary/10 blur-3xl" />
          <div className="relative rounded-2xl border border-fd-border bg-fd-card/90 p-5 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="mb-5 flex items-center justify-between border-b border-fd-border pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground">MessageX runtime</p>
                <p className="mt-1 text-sm font-semibold">A message, from publish to ACK</p>
              </div>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">TCP · v1</span>
            </div>
            <div className="space-y-3">
              {[
                ['01', 'Producer', 'Publish a JSON message', 'border-sky-500/40'],
                ['02', 'Exchange', 'Match bindings and routing key', 'border-violet-500/40'],
                ['03', 'Queue + PostgreSQL', 'Persist a message for each target queue', 'border-emerald-500/40'],
                ['04', 'Consumer', 'Claim and process the delivery', 'border-amber-500/40'],
                ['05', 'ACK / NACK', 'Settle, retry, or dead-letter', 'border-fd-primary/50'],
              ].map(([step, title, detail, border]) => (
                <div key={step} className={`flex items-center gap-4 rounded-xl border bg-fd-background/70 p-3 ${border}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fd-muted text-xs font-bold text-fd-muted-foreground">{step}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-xs leading-5 text-fd-muted-foreground">{detail}</p>
                  </div>
                  {step !== '05' && <span className="ml-auto text-fd-muted-foreground" aria-hidden>↓</span>}
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs leading-5 text-fd-muted-foreground">Explore the full interactive flow in the architecture guide.</p>
          </div>
        </div>
      </section>

      <section className="border-y border-fd-border bg-fd-card/45">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
          {capabilities.map(([title, description]) => (
            <div key={title} className="border-l-2 border-fd-primary/60 pl-4">
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-fd-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 lg:px-10">
        <div className="mb-10 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.2em] text-fd-primary">DOCUMENTATION PATHS</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Find the right starting point.</h2>
          <p className="mt-4 leading-7 text-fd-muted-foreground">From first deployment to the internals of the broker, follow a guide built around real implementation details.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {journeys.map((item) => (
            <Link key={item.number} href={item.href} className="group rounded-2xl border border-fd-border bg-fd-card p-6 transition-all hover:-translate-y-1 hover:border-fd-primary/50 hover:shadow-xl hover:shadow-black/10">
              <span className="text-xs font-bold tracking-[0.16em] text-fd-primary">{item.number} / {item.eyebrow}</span>
              <h3 className="mt-7 text-xl font-semibold">{item.title}</h3>
              <p className="mt-3 min-h-20 text-sm leading-6 text-fd-muted-foreground">{item.description}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-fd-primary">{item.action}<span className="transition-transform group-hover:translate-x-1" aria-hidden>→</span></span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-fd-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 text-xs text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <span>© {new Date().getFullYear()} MessageX · Developer documentation</span>
          <div className="flex gap-5">
            <a href="https://github.com/sameeryadav05/MessageX" className="hover:text-fd-foreground">GitHub</a>
            <a href="https://www.npmjs.com/package/messagex-client" className="hover:text-fd-foreground">npm</a>
            <Link href="/docs" className="hover:text-fd-foreground">All documentation</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
