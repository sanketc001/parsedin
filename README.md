# ParsedIn

A private, local-only knowledge graph of your professional network. Import your
LinkedIn data export and get a searchable, interconnected map of the people,
companies and schools you know — plus private notes and relationship ratings
that never leave your machine.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Data lives in `data/parsedin.json` in the project directory. Nothing is sent
anywhere; there are no external API calls at all.

To see the app working before importing anything real, open **Import** and click
**Load sample network** — 60 synthetic people across real company and school
names, loaded through the same pipeline as a genuine import.

## What it does

| Page | Purpose |
| --- | --- |
| **Overview** | Network size, top companies / schools / locations, recent activity |
| **People** | Faceted search: company, previous company, school, location, title, skill, certification, volunteering, industry, connection degree, plus private signals |
| **Person** | Full career and education history, certifications, volunteering, languages, projects, honors — every row showing where it came from |
| **Companies / Schools** | Explore an organization: who is there now, who used to be, where alumni ended up |
| **Graph** | Force-directed map of people, companies and schools with a hub threshold to keep it readable |
| **Ask** | Plain-English questions answered locally, always showing how the question was read |
| **Import** | Upload archives / CSVs / enriched JSON, with a per-import summary |
| **Sources** | Provenance: every import, what it contributed, which files were read or skipped |

### Questions the Ask page understands

Questions map onto the same filters the People page uses, and the reading is
always displayed, so a misinterpretation is visible rather than mysterious.

Two engines. Without configuration it uses a local rule-based parser and makes
no network calls at all. With Azure OpenAI configured (see below) it uses
gpt-4o for the language, which handles far looser phrasing — *"find me people
who could introduce me to someone at Nvidia"*, *"senior folks in data at
Reliance"*, *"anyone from my old college?"*. The badge on each answer says which
engine produced it, and a **local parser only** checkbox forces the offline
path.

Recognized by both:

- `works at` / `is at` → current employer
- `previously worked at` / `used to work at` / `ex-` → past employer
- `went to` / `studied at` / `graduated from` → school
- `lives in` / `based in` → location
- `knows` / `skilled in` → skills
- `which companies / schools / cities …` → ranked counts
- combine with `and`: *"Who went to IIT and works in AI?"*

Acronyms expand against your data, so **IIT** matches every Indian Institute of
Technology, **TCS** finds Tata Consultancy Services, and spacing variants like
**DY Patil** reach "D Y Patil International University".

## Company resolution

Real exports spell one company several ways and scatter a corporate group across
many legal entities. **Companies → Resolve** cleans this up, using gpt-4o to
adjudicate retrieved web evidence.

Two separate operations, deliberately not conflated:

- **Merge** — the *same* company written differently. `Reliance Jio Infocomm Ltd`
  and `Reliance Jio Infocom Limited`; `Akrudi` and `Akurdi`. Rewrites references
  and absorbs the duplicate. Destructive, so it needs either a web citation or
  names close enough that the spelling itself proves it.
- **Parent link** — genuinely different workplaces in one group. Non-destructive:
  *"who works at JioHotstar"* still answers 8 precisely, while the Reliance group
  rolls up to 81 across 7 entities. A subsidiary is never merged, however
  similar the name looks — merging would destroy which entity someone works at.

```
Reliance Industries Limited [2]
 ├─ Jio Platforms [28]                    Alphabet Inc.
 │   ├─ Jio [32]                           └─ Google [12]
 │   ├─ Reliance Jio Infocom Ltd [3]           ├─ Google Summer of Code [1]
 │   └─ Reliance Jio [2]                       └─ Google Developer Student Clubs [1]
 └─ JioStar [6]
     └─ JioHotstar [8]
```

**Why web evidence rather than model memory.** Asked directly, gpt-4o does not
know JioHotstar, JioStar or JioAds at all, and its answer for Viacom18 is stale —
it reports the Paramount joint venture, missing the 2024 merger into JioStar.
Corporate structure changes faster than a training snapshot, so every
relationship is grounded in retrieved text and carries a citation you can open.
Wikipedia is the default source and needs no key; set `TAVILY_API_KEY` or
`BRAVE_SEARCH_API_KEY` to use a general search API instead.

**Everything is revertible.** Confident conclusions apply automatically, which is
only safe because each one records exactly what it changed — the absorbed company
verbatim, and every person and position whose reference was rewritten. One click
restores it. Uncertain cases queue for review instead.

**Curation survives re-import.** Merges are stored as *rules* keyed on the
normalized name, not as one-off record edits, so importing a later export cannot
resurrect a duplicate you have already dealt with.

How it works: companies are first blocked into candidate clusters locally (shared
rare tokens, brand prefixes, edit distance) — comparing 553 companies pairwise
would be 150k comparisons and an unusable prompt. Each cluster is then grounded
and adjudicated. A final pass reconciles the tops of separate groups, which is
what discovers `Jio Platforms → Reliance Industries`: those two share no
distinctive token, so no cluster could ever contain both.

## Optional: Azure OpenAI

Copy `.env.example` to `.env.local` and fill in:

```
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o        # your deployment name
AZURE_OPENAI_API_VERSION=2024-10-21
```

**What is sent.** Only the question you type, plus your *own* profile's schools
and employers so possessives like "my old college" resolve. No connection of
yours — no names, employers, emails or anything else about them — is ever put in
a prompt. The model's job is purely linguistic: it turns a sentence into a
structured intent naming entities in plain text, and resolving those names
against the actual graph happens locally with the same deterministic code the
offline parser uses. So the model improves language coverage without becoming a
source of truth about your data.

**It is never a dependency.** If the key is missing, wrong, rate-limited or the
request times out, Ask falls back to the local parser, still answers, and shows
what went wrong. Every other page is unaffected.

## Importing

### LinkedIn data export

LinkedIn → *Settings & Privacy* → *Data Privacy* → *Get a copy of your data*.
Request Connections, Positions, Education, Skills, Certifications and
Volunteering, then drop the `.zip` straight onto the Import page — no need to
unpack it. Loose `.csv` files work too.

Recognized: `Connections.csv`, `Profile.csv`, `Email Addresses.csv`,
`Positions.csv`, `Education.csv`, `Skills.csv`, `Certifications.csv`,
`Volunteering.csv`, `Languages.csv`, `Projects.csv`, `Honors.csv`,
`Invitations.csv`. Anything else is reported as skipped rather than silently
dropped.

### The limitation that shapes this product

**LinkedIn's export contains rich history only for you.** For your connections
it provides just name, profile URL, email, current company, current title and
the date you connected — no career history, no education, no skills.

So the archive importer fills out your own profile completely and creates a
lightweight record per connection. To get real depth on the people in your
network, layer in an **enriched profile JSON** import. Records merge onto
existing people by LinkedIn URL first and name second, so enrichment deepens
what you already have instead of duplicating it. Download a template from the
Import page.

### Merge behaviour

Imports are additive and idempotent — re-importing the same archive refreshes
provenance timestamps without duplicating anyone. Specifically:

- People match on normalized LinkedIn URL, then on name; ambiguous name-only
  matches create a new record rather than guessing.
- `Google`, `Google Inc.` and `Google LLC` collapse to one company; the
  shortest surface form becomes the display name and the rest are kept as
  aliases.
- A dateless role from `Connections.csv` is absorbed by the dated version of the
  same role once a richer source supplies it.
- Empty incoming values never erase what is already known.

## Provenance

Every imported fact records the import batch that introduced it and when. On a
person's profile the small ⓘ beside a field reveals the exact source file and
import time; history rows carry the same footer. **Sources** shows the full
import history and which files each batch read or skipped.

Notes and relationship ratings are private: never produced by an import, never
included in one, and preserved when you clear imported data.

## Architecture

```
src/lib/
  types.ts          domain model
  db.ts             the only module touching the filesystem
  entities.ts       company / school registries
  normalize.ts      name, company, URL and date normalization
  match.ts          word-boundary and acronym matching
  derive.ts         read-side projections and lookup indexes
  graph.ts          graph projection
  ingest/           csv reader, entity merge, LinkedIn + enriched importers
  query/            filters, facets, question parser, aggregations
  llm/              optional Azure OpenAI client and question translator
src/app/api/        dataset, import, sample, reset, notes, relationship, ask
```

The client fetches the whole database once and does all filtering, graphing and
question answering in memory — appropriate for a personal network and it keeps
the UI instant. Storage is a single JSON document; `db.ts` is the only file that
would change to move to SQLite.

Deliberately not built, but left room for: job tracking, scraping, messaging,
calendar integration, AI outreach. The ingest layer is source-agnostic (any
importer produces the same provenanced records), and mutations already go
through API routes, so those are additive rather than structural changes.

## Notes

- No tests, no auth, no multi-user support — this is a single-user local tool.
- The graph simulation caps at a configurable number of people; raise the cap in
  the sidebar if you want more on screen at once.
