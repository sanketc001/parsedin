import { NextResponse } from 'next/server';
import { invalidate, loadDb, saveDb } from '@/lib/db';
import { linkParent, mergeCompanies, revert } from '@/lib/resolution';
import { companyKey, slugId } from '@/lib/normalize';
import type { CompanyRelation } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Action =
  | { action: 'accept'; proposalId: string }
  | { action: 'reject'; proposalId: string }
  | { action: 'revert'; undoId: string }
  | { action: 'merge'; duplicateId: string; canonicalId: string }
  | { action: 'link'; childId: string; parentId: string; relation: CompanyRelation }
  | { action: 'unlink'; childId: string };

/**
 * Apply, reject or undo a resolution action. Everything here is reversible:
 * accepted proposals and manual edits alike write an undo record.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Action | null;
  if (!body?.action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  const db = loadDb();

  try {
    switch (body.action) {
      case 'reject': {
        const proposal = db.resolution.proposals.find((p) => p.id === body.proposalId);
        if (!proposal) {
          return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
        }
        proposal.status = 'rejected';
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      case 'accept': {
        const index = db.resolution.proposals.findIndex((p) => p.id === body.proposalId);
        if (index === -1) {
          return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
        }
        const proposal = db.resolution.proposals[index];
        const opts = {
          source: 'manual' as const,
          confidence: proposal.confidence,
          reasoning: proposal.reasoning,
          evidence: proposal.evidence,
          auto: false,
        };

        if (proposal.kind === 'merge') {
          const result = mergeCompanies(db, proposal.companyIds[0], proposal.companyIds[1], opts);
          if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        } else {
          const childId = proposal.companyIds[0];
          let parentId = proposal.companyIds[1];
          // A queued parent proposal may name a holding company that has no
          // record yet; create it on acceptance.
          if (!parentId || !db.companies.some((c) => c.id === parentId)) {
            const name = proposal.names[1];
            const key = companyKey(name);
            if (!key) return NextResponse.json({ error: 'Unusable parent name.' }, { status: 400 });
            const existing = db.companies.find((c) => c.nameKey === key);
            if (existing) {
              parentId = existing.id;
            } else {
              const now = new Date().toISOString();
              parentId = slugId('co', key);
              db.companies.push({
                id: parentId,
                name,
                nameKey: key,
                aliases: [name],
                industry: null,
                website: null,
                parentId: null,
                relationToParent: null,
                synthetic: true,
                sourceBatchIds: [],
                firstSeenAt: now,
                lastUpdatedAt: now,
              });
            }
          }
          const result = linkParent(
            db,
            childId,
            parentId,
            proposal.relation ?? 'affiliate',
            opts,
          );
          if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        }

        db.resolution.proposals.splice(index, 1);
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      case 'revert': {
        const result = revert(db, body.undoId);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      case 'merge': {
        const result = mergeCompanies(db, body.duplicateId, body.canonicalId, {
          source: 'manual',
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      case 'link': {
        const result = linkParent(db, body.childId, body.parentId, body.relation, {
          source: 'manual',
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      case 'unlink': {
        const company = db.companies.find((c) => c.id === body.childId);
        if (!company) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
        company.parentId = null;
        company.relationToParent = null;
        db.resolution.parents = db.resolution.parents.filter((r) => r.childId !== body.childId);
        saveDb(db);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } finally {
    invalidate();
  }
}
