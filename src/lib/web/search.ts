import type { Evidence } from '../types';

// ---------------------------------------------------------------------------
// Web grounding for company resolution.
//
// Why this exists: gpt-4o's training data is not enough here. Asked directly,
// it does not know JioHotstar, JioStar or JioAds at all, and its answer for
// Viacom18 is stale (it reports the Paramount joint venture, missing the 2024
// merger into JioStar). Corporate structure changes faster than a model
// snapshot, so relationships must be grounded in retrieved text.
//
// Azure OpenAI's chat completions API has no built-in web search, so grounding
// is done here and passed in as context. Wikipedia is the default because it
// needs no API key and is unusually good on corporate ownership. A real search
// API is used instead when a key is present.
// ---------------------------------------------------------------------------

export type Provider = 'wikipedia' | 'tavily' | 'brave';

export function activeProvider(): Provider {
  if ((process.env.TAVILY_API_KEY ?? '').trim()) return 'tavily';
  if ((process.env.BRAVE_SEARCH_API_KEY ?? '').trim()) return 'brave';
  return 'wikipedia';
}

const UA = 'ParsedIn/0.1 (private personal-network tool)';

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Grounding is best-effort: a failed lookup means less evidence, not an error.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Wikipedia --------------------------------------------------------------

interface WikiSearchHit {
  title: string;
}

async function wikipediaSearch(query: string, limit: number): Promise<string[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*' +
    `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  const json = (await getJson(url)) as { query?: { search?: WikiSearchHit[] } } | null;
  return (json?.query?.search ?? []).map((h) => h.title);
}

async function wikipediaSummary(title: string): Promise<Evidence | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const json = (await getJson(url)) as
    | {
        title?: string;
        extract?: string;
        description?: string;
        type?: string;
        content_urls?: { desktop?: { page?: string } };
      }
    | null;
  if (!json || !json.extract) return null;
  if (json.type && json.type.includes('not_found')) return null;
  // Disambiguation pages carry no facts worth grounding on.
  if (json.type && json.type.includes('disambiguation')) return null;
  return {
    title: json.title ?? title,
    url:
      json.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    snippet: [json.description, json.extract].filter(Boolean).join(' — ').slice(0, 700),
  };
}

/**
 * Look up a company. Tries the exact title first, since "Jio Platforms" resolves
 * directly, then falls back to search for names that need it ("JioAds").
 */
async function wikipediaLookup(name: string, maxResults: number): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const direct = await wikipediaSummary(name);
  if (direct) out.push(direct);

  if (out.length < maxResults) {
    const titles = await wikipediaSearch(`${name} company`, maxResults);
    for (const title of titles) {
      if (out.length >= maxResults) break;
      if (out.some((e) => e.title === title)) continue;
      const summary = await wikipediaSummary(title);
      if (summary) out.push(summary);
    }
  }
  return out;
}

// --- Tavily -----------------------------------------------------------------

async function tavilyLookup(query: string, maxResults: number): Promise<Evidence[]> {
  const key = (process.env.TAVILY_API_KEY ?? '').trim();
  if (!key) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (json.results ?? [])
      .filter((r) => r.url && r.content)
      .map((r) => ({
        title: r.title ?? r.url!,
        url: r.url!,
        snippet: (r.content ?? '').slice(0, 700),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// --- Brave ------------------------------------------------------------------

async function braveLookup(query: string, maxResults: number): Promise<Evidence[]> {
  const key = (process.env.BRAVE_SEARCH_API_KEY ?? '').trim();
  if (!key) return [];
  const url =
    'https://api.search.brave.com/res/v1/web/search?count=' +
    `${maxResults}&q=${encodeURIComponent(query)}`;
  const json = (await getJson(url, { 'X-Subscription-Token': key })) as
    | { web?: { results?: { title?: string; url?: string; description?: string }[] } }
    | null;
  return (json?.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title ?? r.url!,
      url: r.url!,
      snippet: (r.description ?? '').slice(0, 700),
    }));
}

/**
 * Retrieve evidence about a company name. Never throws — grounding failures
 * degrade the analysis to "unknown", which is the correct outcome.
 */
export async function searchCompany(name: string, maxResults = 2): Promise<Evidence[]> {
  const provider = activeProvider();
  const query = `${name} company parent subsidiary owned by`;
  try {
    if (provider === 'tavily') {
      const hits = await tavilyLookup(query, maxResults);
      if (hits.length > 0) return hits;
    } else if (provider === 'brave') {
      const hits = await braveLookup(query, maxResults);
      if (hits.length > 0) return hits;
    }
    // Wikipedia is both the default and the fallback.
    return await wikipediaLookup(name, maxResults);
  } catch {
    return [];
  }
}
