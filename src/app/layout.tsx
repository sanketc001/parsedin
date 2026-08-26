import type { Metadata } from 'next';
import './globals.css';
import { DataProvider } from '@/components/DataProvider';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'ParsedIn — network intelligence',
  description: 'A private, searchable knowledge graph of your professional network.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DataProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </DataProvider>
      </body>
    </html>
  );
}
