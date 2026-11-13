import Link from 'next/link';

const cards = [
  {
    number: '01',
    title: 'Get started',
    description: 'Run MessageX locally or with Docker and connect your first application.',
    href: '/docs/getting-started/quickstart',
  },
  {
    number: '02',
    title: 'Understand the architecture',
    description: 'Explore the broker, TCP protocol, routing, delivery, and persistence layers.',
    href: '/docs/architecture/overview',
  },
  {
    number: '03',
    title: 'Build with the SDK',
    description: 'Integrate Node.js applications with the official messagex-client package.',
    href: '/docs/sdk/javascript',
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
      <img
        src="/brand/messagex-logo.svg"
        alt="MessageX — Self-hosted message broker"
        className="mb-9 w-full max-w-[420px] rounded-2xl"
      />
      <p className="mb-5 text-xs font-semibold tracking-[0.24em] text-fd-muted-foreground">
        DEVELOPER DOCUMENTATION
      </p>
      <h1 className="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl">
        Messaging infrastructure you can understand and control.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
        Deploy the broker, connect your applications, and learn how MessageX works internally —
        from TCP framing and exchange routing to persistence and consumer recovery.
      </p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          className="rounded-lg bg-fd-primary px-5 py-3 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          href="/docs"
        >
          Explore documentation
        </Link>
        <a
          className="rounded-lg border border-fd-border px-5 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
          href="https://github.com/sameeryadav05/MessageX"
        >
          View on GitHub
        </a>
      </div>
      <div className="mt-20 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-xl border border-fd-border bg-fd-card p-6 transition-colors hover:bg-fd-accent"
          >
            <span className="text-xs font-semibold tracking-[0.18em] text-fd-muted-foreground">
              {card.number}
            </span>
            <h2 className="mt-5 font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{card.description}</p>
            <span className="mt-6 inline-block text-sm font-medium text-fd-primary">
              Read guide →
            </span>
          </Link>
        ))}
      </div>
      <footer className="mt-20 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground">
        MessageX · Self-hosted message broker · Open-source project documentation
      </footer>
    </main>
  );
}
