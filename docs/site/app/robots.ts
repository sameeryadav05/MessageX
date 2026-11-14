import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://messagex.imsameer.me/sitemap.xml',
    host: 'https://messagex.imsameer.me',
  };
}
