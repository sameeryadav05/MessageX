import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import Script from "next/script";
import './global.css';

const siteUrl = 'https://messagex.imsameer.me';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'MessageX Documentation — Self-hosted Message Broker',
    template: '%s | MessageX Docs',
  },
  description:
    'Official MessageX documentation: deploy a self-hosted message broker, integrate Node.js applications, explore TCP protocol internals, queues, exchanges, routing, persistence, and operations.',
  applicationName: 'MessageX Documentation',
  keywords: [
    'MessageX',
    'MessageX documentation',
    'self-hosted message broker',
    'Node.js message broker',
    'TCP message queue',
    'message queue',
    'Docker message broker',
    'JavaScript message broker SDK',
    'PostgreSQL message broker',
    'RabbitMQ alternative',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'MessageX Documentation',
    title: 'MessageX Documentation',
    description:
      'Deploy, integrate, and understand MessageX — a self-hosted message broker with a TCP protocol, PostgreSQL persistence, and a Node.js SDK.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'MessageX developer documentation' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MessageX Documentation',
    description: 'Official guides for deploying and building with MessageX.',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#10121b' },
    { media: '(prefers-color-scheme: light)', color: '#f8f9fc' },
  ],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RootProvider theme={{ defaultTheme: 'dark', enableSystem: false }}>
          {children}

            <script
                src="https://webtrack-ox8a.onrender.com/tracker.js"
                data-site-id="site_2c8a61d1-cfd7-4d2a-803d-8cfc554af614"
                data-api-key="key_3881de69-ec01-42f6-9d5a-dcad7dfa98fe"
            ></script>
        </RootProvider>
      </body>
    </html>
  );
}
