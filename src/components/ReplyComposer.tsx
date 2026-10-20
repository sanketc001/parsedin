'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from './DataProvider';
import { replyTarget, replyUrl } from '@/lib/linkedin';
import { relativeDays } from '@/lib/normalize';
import { statsFor } from '@/lib/contact';
import type { Conversation, Person } from '@/lib/types';

// ---------------------------------------------------------------------------
// Compose a reply here, send it on LinkedIn.
//
// The app cannot send the message itself — see `lib/linkedin.ts` for why that
// is a hard limit rather than a missing feature. What it can do is remove every
// other step: the draft is written with the whole relationship in view, kept
// between sessions, put on the clipboard, and paired with a link straight into
// the right thread. Then it records that you replied, which is the part the
// export can never tell you.
// ---------------------------------------------------------------------------

/**
 * Openers built from what the archive knows. These are starting points to edit,
 * not send — a template pasted verbatim reads like a template.
 */
function suggestions(
  person: Person | null,
  conversation: Conversation | null,
  daysSinceLast: number | null,
): { label: string; text: string }[] {
  const first = person?.fullName.split(' ')[0] ?? 'there';
  const out: { label: string; text: string }[] = [];

  const lastInbound = [...(conversation?.messages ?? [])].reverse().find((m) => !m.outbound);
  if (lastInbound) {
    out.push({
      label: 'Answer them',
      text: `Hi ${first}, thanks for this — and sorry for the slow reply.\n\n`,
    });
  }
  if (daysSinceLast !== null && daysSinceLast > 180) {
    out.push({
      label: 'Pick it back up',
      text: `Hi ${first}, it has been a while — we last spoke ${relativeDays(daysSinceLast)}. ${
        person?.currentCompany ? `Saw you are at ${person.currentCompany} now. ` : ''
      }How have things been?\n\n`,
    });
  }
  if (!conversation) {
    out.push({
      label: 'First message',
      text: `Hi ${first}, we connected a while back but never spoke properly.${
        person?.currentTitle ? ` I saw you are working as ${person.currentTitle} — ` : ' '
      }I would be glad to hear what you are working on.\n\n`,
    });
  }
  out.push({
    label: 'Ask for time',
    text: `Hi ${first}, would you be open to a short call in the next couple of weeks? Happy to work around your schedule.\n\n`,
  });
  return out;
}

export function ReplyComposer({
  person,
  conversation,
  compact,
}: {
  person: Person | null;
  conversation?: Conversation | null;
  /** Render inside an existing card rather than as one. */
  compact?: boolean;
}) {
  const { idx, draftFor, sentDraftsFor, saveDraft, markDraftSent, deleteDraft } = useData();
  const thread = conversation ?? null;
  const key = thread?.id ?? person?.id ?? '';
  const draft = key ? draftFor(key) : null;

  const [text, setText] = useState(draft?.body ?? '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Tracks which draft the textarea was last seeded from, so a refresh caused
  // by our own save does not clobber what is being typed.
  const seededFrom = useRef<string | null>(draft?.id ?? null);

  useEffect(() => {
    if (draft?.id === seededFrom.current) return;
    seededFrom.current = draft?.id ?? null;
    setText(draft?.body ?? '');
  }, [draft?.id, draft?.body]);

  const stats = person ? statsFor(idx.contactByPerson, person.id) : null;
  const sent = person ? sentDraftsFor(person.id) : [];
  const target = replyTarget(thread, person);
  const url = replyUrl(thread, person);
  const options = useMemo(
    () => suggestions(person, thread, stats?.daysSinceLast ?? null),
    [person, thread, stats?.daysSinceLast],
  );

  if (!key) return null;

  const persist = async (value: string) => {
    await saveDraft(
      { conversationId: thread?.id ?? null, personId: person?.id ?? null },
      value,
    );
  };

  /**
   * The one action that matters: put the text where LinkedIn can receive it and
   * open the exact thread. Saving first means nothing is lost if the tab that
   * opens is where attention goes next.
   */
  const copyAndOpen = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await persist(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 4000);
      } catch {
        // Clipboard permission can be refused; the draft is saved either way
        // and the text is still on screen to copy by hand.
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="space-y-2">
      {options.length > 0 && !text.trim() ? (
        <div className="flex flex-wrap gap-1">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setText(option.text)}
              className="chip hover:border-brand/50 hover:text-brand-dark"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        className="input min-h-[7rem] resize-y font-sans leading-relaxed"
        placeholder={
          person ? `Write a reply to ${person.fullName.split(' ')[0]}…` : 'Write a reply…'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Autosave on blur: drafts are worth keeping without a Save click,
          // but saving per keystroke would write the database on every letter.
          if ((draft?.body ?? '') !== text) void persist(text);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!text.trim() || busy}
          onClick={() => void copyAndOpen()}
        >
          {copied ? 'Copied — paste in LinkedIn' : 'Copy & open LinkedIn ↗'}
        </button>

        {draft ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void markDraftSent(draft.id)}
              title="Records that you replied, so Reconnect stops flagging this thread"
            >
              Mark as sent
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                setText('');
                seededFrom.current = null;
                void deleteDraft(draft.id);
              }}
            >
              Discard
            </button>
          </>
        ) : null}

        <span className="ml-auto text-[11px] text-fg-subtle">
          {draft
            ? `draft saved ${new Date(draft.updatedAt).toLocaleString()}`
            : 'not saved yet'}
        </span>
      </div>

      <p className="text-[11px] text-fg-faint">
        {target === 'thread'
          ? 'Opens this exact conversation on LinkedIn with your text on the clipboard — paste and send.'
          : target === 'profile'
            ? 'No thread exists yet, so this opens their profile — use the Message button there.'
            : 'Opens LinkedIn messaging.'}{' '}
        LinkedIn has no messaging API for personal accounts, so the send itself
        stays in their tab.
      </p>

      {sent.length > 0 ? (
        <div className="border-t border-line pt-2">
          <div className="label mb-1">Replies you sent from here</div>
          <ul className="space-y-1">
            {sent.slice(0, 3).map((s) => (
              <li key={s.id} className="text-xs">
                <span className="text-[10px] text-fg-subtle">
                  {new Date(s.sentAt!).toLocaleDateString()}
                </span>{' '}
                <span className="text-fg-muted">
                  {s.body.length > 120 ? `${s.body.slice(0, 120)}…` : s.body}
                </span>
                <button
                  type="button"
                  className="ml-2 text-[10px] text-fg-faint hover:text-fg-muted"
                  onClick={() => void markDraftSent(s.id, false)}
                  title="Reopen as a draft"
                >
                  undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  if (compact) return body;
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-fg">Reply</h2>
      {body}
    </section>
  );
}
