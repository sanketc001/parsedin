'use client';

import { useState } from 'react';
import { useData } from './DataProvider';
import { Section } from './ui';

/** Private, timestamped notes about a person. Never imported, never exported. */
export function NotesPanel({ personId }: { personId: string }) {
  const { notesFor, addNote, updateNote, deleteNote } = useData();
  const notes = notesFor(personId);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notes" count={notes.length}>
      <div className="space-y-2">
        <textarea
          className="input min-h-[64px] resize-y"
          placeholder="Private note — how you met, what they're working on…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-fg-faint">stored locally only</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draft.trim()}
            onClick={() =>
              void run(async () => {
                await addNote(personId, draft.trim());
                setDraft('');
              })
            }
          >
            Add note
          </button>
        </div>

        {error ? <div className="text-xs text-danger">{error}</div> : null}

        <ul className="space-y-2 border-t border-line pt-2">
          {notes.length === 0 ? (
            <li className="text-xs text-fg-faint">No notes yet.</li>
          ) : (
            notes.map((note) => (
              <li key={note.id} className="rounded border border-line bg-surface-sunken p-2">
                {editingId === note.id ? (
                  <>
                    <textarea
                      className="input min-h-[56px] resize-y text-xs"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="mt-1 flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary px-2 py-1 text-xs"
                        disabled={busy || !editDraft.trim()}
                        onClick={() =>
                          void run(async () => {
                            await updateNote(personId, note.id, editDraft.trim());
                            setEditingId(null);
                          })
                        }
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-line text-xs text-fg-muted">{note.body}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-fg-faint">
                        {new Date(note.createdAt).toLocaleString()}
                        {note.updatedAt !== note.createdAt ? ' · edited' : ''}
                      </span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          className="text-[11px] text-fg-subtle hover:text-fg-muted"
                          onClick={() => {
                            setEditingId(note.id);
                            setEditDraft(note.body);
                          }}
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          className="text-[11px] text-fg-subtle hover:text-danger"
                          disabled={busy}
                          onClick={() => void run(() => deleteNote(personId, note.id))}
                        >
                          delete
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </Section>
  );
}
