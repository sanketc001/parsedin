import { NextResponse } from 'next/server';
import { loadDb } from '@/lib/db';
import { parseQuestion } from '@/lib/query/nl';
import { isConfigured } from '@/lib/llm/azure';
import { parseQuestionWithLlm } from '@/lib/llm/question';

export const dynamic = 'force-dynamic';

/** Report whether LLM assistance is available, so the UI can say so up front. */
export async function GET() {
  return NextResponse.json({ llmAvailable: isConfigured() });
}

/**
 * Translate a question into a structured query.
 *
 * Returns only the parsed query — the client already holds the dataset and
 * applies filters locally, which keeps results instant and means the network
 * itself is never shipped to the model.
 *
 * The LLM is an enhancement, never a dependency: if it is unconfigured, errors,
 * or times out, this falls back to the rule-based parser and says so.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { question?: string; localOnly?: boolean }
    | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const db = loadDb();
  const useLlm = !body?.localOnly && isConfigured();

  if (useLlm) {
    try {
      const { parsed, reading } = await parseQuestionWithLlm(question, db);
      return NextResponse.json({ engine: 'llm', reading, parsed });
    } catch (err) {
      // Degrade rather than fail: answer with rules and report what went wrong.
      return NextResponse.json({
        engine: 'rules',
        llmError: (err as Error).message,
        parsed: parseQuestion(question, db),
      });
    }
  }

  return NextResponse.json({
    engine: 'rules',
    llmAvailable: isConfigured(),
    parsed: parseQuestion(question, db),
  });
}
