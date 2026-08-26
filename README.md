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

Rule-based and fully local — no model calls. It maps phrasings onto the same
filters the People page uses and always displays its interpretation, so a
misreading is visible rather than mysterious.

- `works at` / `is at` → current employer
- `previously worked at` / `used to work at` / `ex-` → past employer
- `went to` / `studied at` / `graduated from` → school
- `lives in` / `based in` → location
- `knows` / `skilled in` → skills
- `which companies / schools / cities …` → ranked counts
- combine with `and`: *"Who went to IIT and works in AI?"*

Acronyms expand against your data, so **IIT** matches every Indian Institute of
Technology and **BITS** finds BITS Pilani.

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
src/app/api/        dataset, import, sample, reset, notes, relationship
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
