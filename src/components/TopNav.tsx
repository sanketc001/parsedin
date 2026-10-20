'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData } from './DataProvider';

// ---------------------------------------------------------------------------
// The global bar.
//
// Modelled on LinkedIn's: a white rail pinned to the top, the mark on the left,
// a search field, then icon-over-label tabs that mark the active one with a
// rule underneath. Thirteen destinations do not fit that pattern, so the six
// most-used are tabs and the rest live behind "More" — which is how LinkedIn
// handles the same problem.
// ---------------------------------------------------------------------------

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

/** 20px line icons, sized and stroked to match LinkedIn's nav glyphs. */
const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    {path}
  </svg>
);

const PRIMARY: Item[] = [
  {
    href: '/',
    label: 'Home',
    icon: icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  },
  {
    href: '/people',
    label: 'People',
    icon: icon(
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M17 11a3 3 0 1 0-1.6-5.5" />
        <path d="M18 20c0-2.4-.7-4.2-2-5.4" />
      </>,
    ),
  },
  {
    href: '/companies',
    label: 'Companies',
    icon: icon(
      <>
        <path d="M3 21h18" />
        <path d="M5 21V6l7-3v18" />
        <path d="M12 21V9l7 2v10" />
        <path d="M8 9h1M8 13h1M8 17h1M15 13h1M15 17h1" />
      </>,
    ),
  },
  {
    href: '/reconnect',
    label: 'Reconnect',
    icon: icon(
      <>
        <path d="M20 12a8 8 0 1 1-2.3-5.6" />
        <path d="M20 3v4h-4" />
      </>,
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: icon(
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.5 6.5 8.5 6 8.5-6" />
      </>,
    ),
  },
  {
    href: '/jobs',
    label: 'Jobs',
    icon: icon(
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
        <path d="M3 12h18" />
      </>,
    ),
  },
];

const MORE = [
  { href: '/schools', label: 'Schools' },
  { href: '/graph', label: 'Graph' },
  { href: '/ask', label: 'Ask' },
  { href: '/activity', label: 'Footprint' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/import', label: 'Import' },
  { href: '/sources', label: 'Sources' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { db, idx, loading } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Same count the Reconnect page shows, so the badge never disagrees with it.
  const needsReply = useMemo(
    () => [...idx.contactByPerson.values()].filter((s) => s.awaitingYourReply).length,
    [idx.contactByPerson],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  // Navigating is the only thing that should close the menu on its own.
  useEffect(() => setMenuOpen(false), [pathname]);

  const moreActive = MORE.some((m) => isActive(pathname, m.href));

  return (
    <header className="sticky top-0 z-30 h-[var(--nav-h)] border-b border-line bg-surface shadow-nav">
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-2 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="ParsedIn home">
          {/* LinkedIn's mark is a blue rounded square holding lowercase "in". */}
          <span className="grid h-8 w-8 place-items-center rounded bg-brand font-semibold text-white">
            in
          </span>
          <span className="hidden text-base font-semibold tracking-tight text-fg sm:block">
            Parsed<span className="text-brand">In</span>
          </span>
        </Link>

        <form
          className="ml-1 hidden min-w-0 flex-1 md:block lg:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (q) router.push(`/people?q=${encodeURIComponent(q)}`);
          }}
          role="search"
        >
          <label className="sr-only" htmlFor="global-search">
            Search people
          </label>
          <input
            id="global-search"
            className="w-full rounded border border-transparent bg-brand-tint px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:bg-surface focus:outline-none"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <nav className="ml-auto flex h-full items-stretch">
          {PRIMARY.map((item) => (
            <NavTab
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              badge={item.href === '/reconnect' ? needsReply : 0}
            />
          ))}

          <div className="relative flex items-stretch" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className={`flex w-[4.5rem] flex-col items-center justify-center gap-0.5 border-b-2 px-1 transition-colors ${
                moreActive || menuOpen
                  ? 'border-fg text-fg'
                  : 'border-transparent text-fg-subtle hover:text-fg'
              }`}
            >
              {icon(
                <>
                  <circle cx="5" cy="12" r="1.4" />
                  <circle cx="12" cy="12" r="1.4" />
                  <circle cx="19" cy="12" r="1.4" />
                </>,
              )}
              <span className="text-[11px] leading-none">More ▾</span>
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[var(--nav-h)] w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-raised"
              >
                {MORE.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={`block px-4 py-2 text-sm transition-colors hover:bg-surface-sunken ${
                      isActive(pathname, item.href)
                        ? 'font-semibold text-brand'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mt-1 border-t border-line px-4 pb-1 pt-2 text-[11px] text-fg-faint">
                  {loading ? (
                    'loading…'
                  ) : (
                    <>
                      <div>{db.people.length.toLocaleString()} people</div>
                      <div>{db.companies.length.toLocaleString()} companies</div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  );
}

function NavTab({ item, active, badge }: { item: Item; active: boolean; badge: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex w-[4.5rem] flex-col items-center justify-center gap-0.5 border-b-2 px-1 transition-colors ${
        active ? 'border-fg text-fg' : 'border-transparent text-fg-subtle hover:text-fg'
      }`}
    >
      {item.icon}
      <span className="text-[11px] leading-none">{item.label}</span>
      {badge > 0 ? (
        <span
          className="absolute right-3 top-1 min-w-[1rem] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white"
          title={`${badge} people are waiting on a reply`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
