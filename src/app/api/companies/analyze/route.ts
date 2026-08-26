import { NextResponse } from 'next/server';
import { invalidate, loadDb, saveDb } from '@/lib/db';
import { isConfigured } from '@/lib/llm/azure';
import { analyzeCompanies, buildClusters } from '@/lib/llm/companies';
import { activeProvider } from '@/lib/web/search';

export const dynamic = 'force-dynamic';
// Grounding plus one model call per cluster takes a while on a large network.
export const maxDuration = 600;

/** What a run would look at, without spending anything. */
export async function GET() {
  const db = loadDb();
  const clusters = buildClusters(db);
  return NextResponse.json({
    llmAvailable: isConfigured(),
    webProvider: activeProvider(),
    companies: db.companies.length,
    clusters: clusters.length,
    lastAnalyzedAt: db.resolution.lastAnalyzedAt,
    preview: clusters.slice(0, 12).map((c) => ({
      headcount: c.headcount,
      names: c.companies.map((x) => x.name),
    })),
  });
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Azure OpenAI is not configured. Add AZURE_OPENAI_* to .env.local.' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        maxClusters?: number;
        skipWeb?: boolean;
        dryRun?: boolean;
        mergeThreshold?: number;
        parentThreshold?: number;
        skipRoots?: boolean;
        maxRoots?: number;
      }
    | null;

  const db = loadDb();
  try {
    const report = await analyzeCompanies(db, {
      maxClusters: body?.maxClusters,
      skipWeb: body?.skipWeb,
      dryRun: body?.dryRun,
      mergeThreshold: body?.mergeThreshold,
      parentThreshold: body?.parentThreshold,
      skipRoots: body?.skipRoots,
      maxRoots: body?.maxRoots,
    });
    saveDb(db);
    return NextResponse.json({ report });
  } catch (err) {
    console.error('[parsedin] company analysis failed:', err);
    return NextResponse.json({ error: String((err as Error).message) }, { status: 500 });
  } finally {
    invalidate();
  }
}
