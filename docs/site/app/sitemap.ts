import type { MetadataRoute } from 'next';

const siteUrl = 'https://messagex.imsameer.me';

const documentationPaths = [
  '/docs',
  '/docs/getting-started/prerequisites',
  '/docs/getting-started/quickstart',
  '/docs/getting-started/docker-compose',
  '/docs/getting-started/contributor-setup',
  '/docs/architecture/overview',
  '/docs/architecture/broker-internals',
  '/docs/architecture/protocol',
  '/docs/architecture/message-lifecycle',
  '/docs/architecture/storage-and-reliability',
  '/docs/sdk/javascript',
  '/docs/sdk/python',
  '/docs/sdk/java',
  '/docs/configuration/environment-variables',
  '/docs/deployment/docker-images',
  '/docs/deployment/production',
  '/docs/reference/commands',
  '/docs/reference/management-api',
  '/docs/reference/ports',
  '/docs/reference/troubleshooting',
  '/docs/development/repository-layout',
  '/docs/development/testing',
  '/docs/development/contribution-workflow',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...documentationPaths.map((path) => ({
      url: new URL(path, siteUrl).toString(),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: path === '/docs' ? 0.9 : 0.7,
    })),
  ];
}
