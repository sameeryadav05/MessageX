import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from 'fumadocs-ui/page';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

const siteUrl = 'https://messagex.imsameer.me';

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description && (
        <DocsDescription>{page.data.description}</DocsDescription>
      )}
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const path = `/docs/${slug.join('/')}`;
  const title = `${page.data.title} | MessageX Documentation`;
  const description = page.data.description ??
    'Technical guides and reference documentation for the MessageX self-hosted message broker.';

  return {
    title: page.data.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      url: new URL(path, siteUrl).toString(),
      siteName: 'MessageX Documentation',
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}
