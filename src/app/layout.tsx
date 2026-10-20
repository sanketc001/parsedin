import type { Metadata } from 'next';
import './globals.css';
import { DataProvider } from '@/components/DataProvider';
import { TopNav } from '@/components/TopNav';

export const metadata: Metadata = {
  title: 'ParsedIn — network intelligence',
  description: 'A private, searchable knowledge graph of your professional network.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DataProvider>
          <TopNav />
          {/* Wider than LinkedIn's 1128px feed: these pages are tables and a
              graph, and cramping them to feed width would cost more than the
              resemblance is worth. */}
          <main className="mx-auto min-h-[calc(100vh-var(--nav-h))] w-full max-w-[1400px]">
            {children}
          </main>
        </DataProvider>
      </body>
    </html>
  );
}
