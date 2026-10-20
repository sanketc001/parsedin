'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  emptyDatabase,
  type Database,
  type Draft,
  type Note,
  type Relationship,
} from '@/lib/types';
import { buildIndexes, type Indexes } from '@/lib/derive';

// ---------------------------------------------------------------------------
// One fetch of the whole database, held in memory and shared by every page.
// Filtering, graphing and question answering all run against this, so the UI
// stays instant and there is a single definition of "the data".
// ---------------------------------------------------------------------------

interface DataContextValue {
  db: Database;
  idx: Indexes;
  loading: boolean;
  error: string | null;
  /** Re-fetch from the server, e.g. after an import. */
  refresh: () => Promise<void>;
  notesFor: (personId: string) => Note[];
  relationshipFor: (personId: string) => Relationship | null;
  addNote: (personId: string, body: string) => Promise<void>;
  updateNote: (personId: string, noteId: string, body: string) => Promise<void>;
  deleteNote: (personId: string, noteId: string) => Promise<void>;
  setStrength: (personId: string, strength: number | null) => Promise<void>;
  setTags: (personId: string, tags: string[]) => Promise<void>;
  /** The open (unsent) draft for a thread or person, if there is one. */
  draftFor: (key: string) => Draft | null;
  /** Sent replies for a person, newest first — the record LinkedIn will not have. */
  sentDraftsFor: (personId: string) => Draft[];
  saveDraft: (target: DraftTarget, body: string) => Promise<void>;
  markDraftSent: (draftId: string, sent?: boolean) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
}

export interface DraftTarget {
  conversationId?: string | null;
  personId?: string | null;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(emptyDatabase);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dataset', { cache: 'no-store' });
      if (!res.ok) throw new Error(`dataset request failed (${res.status})`);
      const json = (await res.json()) as Database;
      setDb(json);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Indexes are derived, so rebuild them only when the database identity changes.
  const idx = useMemo(() => buildIndexes(db), [db]);

  const notesByPerson = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of db.notes) {
      const list = map.get(note.personId);
      if (list) list.push(note);
      else map.set(note.personId, [note]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return map;
  }, [db.notes]);

  const relByPerson = useMemo(() => {
    const map = new Map<string, Relationship>();
    for (const rel of db.relationships) map.set(rel.personId, rel);
    return map;
  }, [db.relationships]);

  const notesFor = useCallback(
    (personId: string) => notesByPerson.get(personId) ?? [],
    [notesByPerson],
  );
  const relationshipFor = useCallback(
    (personId: string) => relByPerson.get(personId) ?? null,
    [relByPerson],
  );

  const mutate = useCallback(
    async (url: string, init: RequestInit) => {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `request failed (${res.status})`);
      }
      await refresh();
    },
    [refresh],
  );

  const addNote = useCallback(
    (personId: string, body: string) =>
      mutate(`/api/people/${encodeURIComponent(personId)}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    [mutate],
  );

  const updateNote = useCallback(
    (personId: string, noteId: string, body: string) =>
      mutate(`/api/people/${encodeURIComponent(personId)}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ noteId, body }),
      }),
    [mutate],
  );

  const deleteNote = useCallback(
    (personId: string, noteId: string) =>
      mutate(`/api/people/${encodeURIComponent(personId)}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ noteId, delete: true }),
      }),
    [mutate],
  );

  const setStrength = useCallback(
    (personId: string, strength: number | null) =>
      mutate(`/api/people/${encodeURIComponent(personId)}/relationship`, {
        method: 'PUT',
        body: JSON.stringify({ strength }),
      }),
    [mutate],
  );

  const openDrafts = useMemo(() => {
    const map = new Map<string, Draft>();
    for (const draft of db.drafts) {
      if (!draft.sentAt) map.set(draft.key, draft);
    }
    return map;
  }, [db.drafts]);

  const sentDrafts = useMemo(() => {
    const map = new Map<string, Draft[]>();
    for (const draft of db.drafts) {
      if (!draft.sentAt || !draft.personId) continue;
      const list = map.get(draft.personId);
      if (list) list.push(draft);
      else map.set(draft.personId, [draft]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
    }
    return map;
  }, [db.drafts]);

  const draftFor = useCallback((key: string) => openDrafts.get(key) ?? null, [openDrafts]);
  const sentDraftsFor = useCallback(
    (personId: string) => sentDrafts.get(personId) ?? [],
    [sentDrafts],
  );

  const saveDraft = useCallback(
    (target: DraftTarget, body: string) =>
      mutate('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: target.conversationId ?? null,
          personId: target.personId ?? null,
          body,
        }),
      }),
    [mutate],
  );

  const markDraftSent = useCallback(
    (draftId: string, sent = true) =>
      mutate('/api/drafts', { method: 'PATCH', body: JSON.stringify({ draftId, sent }) }),
    [mutate],
  );

  const deleteDraft = useCallback(
    (draftId: string) =>
      mutate('/api/drafts', { method: 'PATCH', body: JSON.stringify({ draftId, delete: true }) }),
    [mutate],
  );

  const setTags = useCallback(
    (personId: string, tags: string[]) => {
      const current = relByPerson.get(personId);
      return mutate(`/api/people/${encodeURIComponent(personId)}/relationship`, {
        method: 'PUT',
        body: JSON.stringify({ strength: current?.strength ?? 3, tags }),
      });
    },
    [mutate, relByPerson],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      db,
      idx,
      loading,
      error,
      refresh,
      notesFor,
      relationshipFor,
      addNote,
      updateNote,
      deleteNote,
      setStrength,
      setTags,
      draftFor,
      sentDraftsFor,
      saveDraft,
      markDraftSent,
      deleteDraft,
    }),
    [
      db, idx, loading, error, refresh, notesFor, relationshipFor,
      addNote, updateNote, deleteNote, setStrength, setTags,
      draftFor, sentDraftsFor, saveDraft, markDraftSent, deleteDraft,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}
