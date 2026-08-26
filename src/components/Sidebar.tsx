'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useData } from './DataProvider';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/people', label: 'People' },
  { href: '/companies', label: 'Companies' },
  { href: '/schools', label: 'Schools' },
  { href: '/graph', label: 'Graph' },
  { href: '/ask', label: 'Ask' },
  { href: '/import', label: 'Import' },
  { href: '/sources', label: 'Sources' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { db, loading } = useData();

  return (
    <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <div className="border-b border-ink-700 px-4 py-4">
        <Link href="/" className="block">
          <div className="font-mono text-sm font-semibold tracking-tight text-slate-100">
            Parsed<span className="text-accent">In</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">network intelligence</div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-accent/15 text-accent-soft'
                  : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-700 px-4 py-3 font-mono text-[11px] text-slate-500">
        {loading ? (
          <div>loading…</div>
        ) : (
          <>
            <div>{db.people.length.toLocaleString()} people</div>
            <div>{db.companies.length.toLocaleString()} companies</div>
            <div>{db.schools.length.toLocaleString()} schools</div>
          </>
        )}
      </div>
    </aside>
  );
}
