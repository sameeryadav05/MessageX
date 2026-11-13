import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...baseOptions()}
      tree={source.getPageTree()}
      sidebar={{ collapsible: true }}
      themeSwitch={{ enabled: true, mode: 'light-dark' }}
      searchToggle={{ enabled: true }}
    >
      {children}
    </DocsLayout>
  );
}
