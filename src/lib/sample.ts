// ---------------------------------------------------------------------------
// Synthetic demo network.
//
// Generated in the enriched-profile shape and pushed through the real importer,
// so loading the sample exercises exactly the same code path as a genuine
// import (including provenance). People are obviously fictional; company and
// school names are real so that the example questions are meaningful.
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the sample is identical every time it is loaded. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Ananya', 'Rohan', 'Meera', 'Arjun', 'Divya', 'Kabir', 'Sneha', 'Vikram',
  'Priya', 'Aditya', 'Ishita', 'Nikhil', 'Tara', 'Siddharth', 'Nandini',
  'Rahul', 'Lakshmi', 'Karthik', 'Aisha', 'Varun', 'Elena', 'Marcus',
  'Sofia', 'Daniel', 'Yuki', 'Chen', 'Amara', 'Tobias', 'Leila', 'Owen',
];

const LAST = [
  'Iyer', 'Sharma', 'Nair', 'Reddy', 'Kapoor', 'Menon', 'Bose', 'Rao',
  'Chatterjee', 'Malhotra', 'Deshpande', 'Krishnan', 'Verma', 'Pillai',
  'Sundaram', 'Aggarwal', 'Novak', 'Okafor', 'Rossi', 'Tanaka', 'Lindqvist',
  'Duarte', 'Haddad', 'Whitfield',
];

const COMPANIES = [
  'Google', 'Microsoft', 'Amazon', 'McKinsey & Company', 'Bain & Company',
  'Boston Consulting Group', 'Stripe', 'Flipkart', 'Zerodha', 'Infosys',
  'Tata Consultancy Services', 'Razorpay', 'Swiggy', 'Freshworks', 'Zoho',
  'Goldman Sachs', 'JPMorgan Chase', 'Deloitte', 'Accenture', 'Adobe',
  'Nvidia', 'Databricks', 'Snowflake', 'Uber', 'Atlassian',
];

const SCHOOLS = [
  'Indian Institute of Technology Bombay',
  'Indian Institute of Technology Delhi',
  'Indian Institute of Technology Madras',
  'Indian Institute of Technology Kanpur',
  'Indian Institute of Management Ahmedabad',
  'Indian Institute of Management Bangalore',
  'Birla Institute of Technology and Science, Pilani',
  'National Institute of Technology Trichy',
  'Delhi University',
  'Stanford University',
  'Massachusetts Institute of Technology',
  'Carnegie Mellon University',
  'London Business School',
  'INSEAD',
];

const LOCATIONS = [
  'Bengaluru, Karnataka, India', 'Mumbai, Maharashtra, India',
  'Hyderabad, Telangana, India', 'Pune, Maharashtra, India',
  'Gurugram, Haryana, India', 'Chennai, Tamil Nadu, India',
  'Delhi, India', 'San Francisco, California, United States',
  'Seattle, Washington, United States', 'London, United Kingdom',
  'Singapore', 'Berlin, Germany', 'Dubai, United Arab Emirates',
];

const TRACKS: { titles: string[]; skills: string[]; industry: string }[] = [
  {
    titles: ['Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Engineering Manager'],
    skills: ['Python', 'Distributed Systems', 'Kubernetes', 'Go', 'PostgreSQL'],
    industry: 'Software Development',
  },
  {
    titles: ['Machine Learning Engineer', 'Senior ML Engineer', 'Applied Scientist', 'Head of AI'],
    skills: ['Machine Learning', 'Deep Learning', 'PyTorch', 'NLP', 'Computer Vision', 'AI Strategy'],
    industry: 'Artificial Intelligence',
  },
  {
    titles: ['Data Analyst', 'Data Scientist', 'Senior Data Scientist', 'Director of Data'],
    skills: ['SQL', 'Statistics', 'Machine Learning', 'Tableau', 'Experimentation'],
    industry: 'Data & Analytics',
  },
  {
    titles: ['Business Analyst', 'Consultant', 'Engagement Manager', 'Partner'],
    skills: ['Strategy', 'Financial Modeling', 'Market Entry', 'Operations'],
    industry: 'Management Consulting',
  },
  {
    titles: ['Associate Product Manager', 'Product Manager', 'Senior Product Manager', 'Director of Product'],
    skills: ['Product Strategy', 'User Research', 'Roadmapping', 'SQL', 'A/B Testing'],
    industry: 'Product Management',
  },
  {
    titles: ['Designer', 'Product Designer', 'Senior Product Designer', 'Design Lead'],
    skills: ['Figma', 'Design Systems', 'Interaction Design', 'User Research'],
    industry: 'Design',
  },
  {
    titles: ['Investment Banking Analyst', 'Associate', 'Vice President', 'Managing Director'],
    skills: ['Valuation', 'M&A', 'Financial Modeling', 'Due Diligence'],
    industry: 'Financial Services',
  },
];

const DEGREES = ['B.Tech', 'B.E.', 'B.Sc', 'M.Tech', 'M.S.', 'MBA', 'PhD'];
const FIELDS = [
  'Computer Science', 'Electrical Engineering', 'Mechanical Engineering',
  'Economics', 'Mathematics', 'Business Administration', 'Physics',
  'Information Technology',
];
const CERTS = [
  { name: 'AWS Certified Solutions Architect', authority: 'Amazon Web Services' },
  { name: 'Google Cloud Professional Data Engineer', authority: 'Google' },
  { name: 'Certified Scrum Master', authority: 'Scrum Alliance' },
  { name: 'CFA Level II', authority: 'CFA Institute' },
  { name: 'TensorFlow Developer Certificate', authority: 'Google' },
  { name: 'PMP', authority: 'Project Management Institute' },
];
const VOLUNTEER = [
  { organization: 'Teach For India', role: 'Mentor', cause: 'Education' },
  { organization: 'Goonj', role: 'Volunteer', cause: 'Poverty Alleviation' },
  { organization: 'Robin Hood Army', role: 'Chapter Volunteer', cause: 'Human Rights' },
  { organization: 'CRY - Child Rights and You', role: 'Fundraiser', cause: 'Children' },
  { organization: 'Greenpeace India', role: 'Campaign Volunteer', cause: 'Environment' },
];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Kannada', 'Marathi', 'German', 'French', 'Japanese'];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SampleOptions {
  count?: number;
  seed?: number;
}

/** Build the demo network in enriched-profile JSON shape. */
export function buildSampleProfiles(opts: SampleOptions = {}): any {
  const count = opts.count ?? 60;
  const rnd = mulberry32(opts.seed ?? 20260826);
  const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const pickN = <T,>(list: T[], n: number): T[] => {
    const pool = [...list];
    const out: T[] = [];
    for (let i = 0; i < n && pool.length > 0; i += 1) {
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  };

  const used = new Set<string>();
  const profiles: any[] = [];

  for (let i = 0; i < count; i += 1) {
    let fullName = `${pick(FIRST)} ${pick(LAST)}`;
    let guard = 0;
    while (used.has(fullName) && guard < 50) {
      fullName = `${pick(FIRST)} ${pick(LAST)}`;
      guard += 1;
    }
    used.add(fullName);

    const track = pick(TRACKS);
    const location = pick(LOCATIONS);

    // Career: 1–3 roles, oldest first, each ~2–4 years, most recent ongoing.
    const roleCount = 1 + Math.floor(rnd() * 3);
    const employers = pickN(COMPANIES, roleCount);
    const startYear = 2010 + Math.floor(rnd() * 9);
    const positions: any[] = [];
    let year = startYear;
    for (let r = 0; r < roleCount; r += 1) {
      const isLast = r === roleCount - 1;
      const span = 2 + Math.floor(rnd() * 3);
      const month = 1 + Math.floor(rnd() * 12);
      const titleIdx = Math.min(TRACKS[0].titles.length - 1, r + Math.floor(rnd() * 2));
      positions.push({
        title: track.titles[Math.min(titleIdx, track.titles.length - 1)],
        company: employers[r],
        startDate: `${year}-${String(month).padStart(2, '0')}`,
        endDate: isLast ? null : `${year + span}-${String(month).padStart(2, '0')}`,
        isCurrent: isLast,
        location: location.split(',')[0],
        description: isLast ? undefined : `Worked on ${pick(track.skills)}.`,
      });
      year += span;
    }
    // Reported newest-first, the way profiles read.
    positions.reverse();
    const current = positions[0];

    const eduCount = rnd() < 0.35 ? 2 : 1;
    const schools = pickN(SCHOOLS, eduCount);
    const education = schools.map((school, k) => {
      const end = startYear - k * 2;
      return {
        school,
        degree: k === 0 ? pick(DEGREES) : 'MBA',
        fieldOfStudy: pick(FIELDS),
        startDate: `${end - 4}`,
        endDate: `${end}`,
      };
    });

    profiles.push({
      fullName,
      linkedinUrl: `https://www.linkedin.com/in/${slugify(fullName)}-${(1000 + i).toString(36)}/`,
      headline: `${current.title} at ${current.company}`,
      location,
      industry: track.industry,
      connectionDegree: rnd() < 0.82 ? 1 : 2,
      connectedOn: `${2018 + Math.floor(rnd() * 8)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
      summary:
        rnd() < 0.5
          ? `${track.industry} professional focused on ${pick(track.skills).toLowerCase()}.`
          : undefined,
      currentTitle: current.title,
      currentCompany: current.company,
      positions,
      education,
      skills: pickN(track.skills, 2 + Math.floor(rnd() * 3)),
      certifications: rnd() < 0.4 ? [{ ...pick(CERTS), startDate: `${2019 + Math.floor(rnd() * 6)}` }] : [],
      volunteering: rnd() < 0.3 ? [pick(VOLUNTEER)] : [],
      languages: pickN(LANGUAGES, 1 + Math.floor(rnd() * 2)).map((name) => ({
        name,
        proficiency: name === 'English' ? 'Full professional' : 'Professional working',
      })),
      projects: [],
      honors: rnd() < 0.15 ? [{ title: 'Dean\'s List', issuer: schools[0], date: `${startYear}` }] : [],
    });
  }

  return { profiles };
}

// ---------------------------------------------------------------------------
// Synthetic activity archive.
//
// Emitted as real LinkedIn-shaped CSVs rather than injected into the database,
// so the demo runs through exactly the same parsers as a genuine export — the
// sample is a smoke test of the importer as much as it is a showcase.
// ---------------------------------------------------------------------------

/** One CSV cell, quoted the way LinkedIn quotes them. */
function cell(value: string | null | undefined): string {
  const s = value ?? '';
  return `"${s.replace(/"/g, '""')}"`;
}

function csv(headers: string[], rows: (string | null | undefined)[][]): string {
  return [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

const OPENERS = [
  'Hi {first}, enjoyed your post on {topic} — would love to compare notes.',
  'Hey {first}! Are you still working on {topic} over at {company}?',
  'Hi {first}, a colleague suggested I reach out about {topic}.',
  'Congrats on the move to {company}! How is it going so far?',
];

const REPLIES = [
  'Thanks for reaching out — happy to chat. How does next week look?',
  'Good to hear from you! Yes, still deep in {topic}. What did you have in mind?',
  'Appreciate the note. Let me come back to you once this quarter settles.',
  'Absolutely — {topic} is most of my week right now. Coffee sometime?',
  'Sounds good. I will send over a couple of times.',
];

const TOPICS = [
  'retrieval pipelines',
  'platform migration',
  'hiring for the team',
  'the pricing redesign',
  'inference costs',
  'the data mesh rollout',
];

export interface SampleActivity {
  name: string;
  content: string;
}

/**
 * Build the CSV side of the demo: messages, invitations, endorsements, job
 * applications, follows and feed activity for the generated profiles.
 *
 * `self` is the account owner these files are written from. The caller passes
 * the real owner when one already exists, so demo threads never claim to be
 * from somebody else.
 */
export function buildSampleActivity(
  profiles: { fullName: string; linkedinUrl: string; currentCompany: string; skills: string[] }[],
  self: { fullName: string; linkedinUrl: string },
  opts: SampleOptions = {},
): SampleActivity[] {
  const rnd = mulberry32((opts.seed ?? 20260826) + 7);
  const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const now = Date.now();
  const DAY = 86_400_000;

  const stamp = (ms: number): string =>
    new Date(ms).toISOString().replace('T', ' ').slice(0, 19).concat(' UTC');
  const fill = (template: string, person: (typeof profiles)[number], topic: string): string =>
    template
      .replace('{first}', person.fullName.split(' ')[0])
      .replace('{company}', person.currentCompany)
      .replace('{topic}', topic);

  const messages: string[][] = [];
  const invitations: string[][] = [];
  const endorsements: string[][] = [];

  // Roughly a third of the network has actually been spoken to — deliberately
  // close to the real-world ratio, since that gap is what Reconnect surfaces.
  const contacts = profiles.filter(() => rnd() < 0.34);

  contacts.forEach((person, i) => {
    const topic = pick(TOPICS);
    const length = 1 + Math.floor(rnd() * 7);
    // Threads are spread across four years so some are fresh and some dormant.
    const start = now - Math.floor(rnd() * 1400 + 3) * DAY;
    // A quarter of threads are one-sided: sent into the void, or a cold pitch.
    const oneSided = rnd() < 0.25;
    const theyStarted = rnd() < 0.45;
    const conversationId = `2-sample-${i}`;

    let when = start;
    for (let m = 0; m < length; m += 1) {
      const outbound = oneSided ? !theyStarted : (m % 2 === 0) !== theyStarted;
      const body =
        m === 0
          ? fill(pick(OPENERS), person, topic)
          : fill(pick(REPLIES), person, topic);
      messages.push([
        conversationId,
        '',
        outbound ? self.fullName : person.fullName,
        outbound ? self.linkedinUrl : person.linkedinUrl,
        outbound ? person.fullName : self.fullName,
        outbound ? person.linkedinUrl : self.linkedinUrl,
        stamp(when),
        '',
        body,
        rnd() < 0.15 ? 'ARCHIVE' : 'INBOX',
        '',
      ]);
      when += Math.floor(rnd() * 6 + 1) * DAY;
    }
  });

  for (const person of profiles) {
    if (rnd() > 0.25) continue;
    const outgoing = rnd() < 0.6;
    invitations.push([
      outgoing ? self.fullName : person.fullName,
      outgoing ? person.fullName : self.fullName,
      new Date(now - Math.floor(rnd() * 1600) * DAY).toLocaleString('en-US'),
      rnd() < 0.3 ? `Hi ${person.fullName.split(' ')[0]}, we met at the meetup — let's connect.` : '',
      outgoing ? 'OUTGOING' : 'INCOMING',
      outgoing ? self.linkedinUrl : person.linkedinUrl,
      outgoing ? person.linkedinUrl : self.linkedinUrl,
    ]);
  }

  for (const person of profiles) {
    if (rnd() > 0.18 || person.skills.length === 0) continue;
    const [first, ...rest] = person.fullName.split(' ');
    endorsements.push([
      stamp(now - Math.floor(rnd() * 1400) * DAY).replace(/-/g, '/'),
      pick(person.skills),
      first,
      rest.join(' '),
      person.linkedinUrl.replace(/^https:\/\/www\./, 'www.'),
      'ACCEPTED',
    ]);
  }

  // Applications aim at companies that appear in the network, so the warm-intro
  // join on the Jobs page has something to find.
  const employers = Array.from(new Set(profiles.map((p) => p.currentCompany)));
  const applications = employers.slice(0, 8).map((company, i) => [
    new Date(now - (i * 21 + 5) * DAY).toLocaleString('en-US'),
    'you@example.com',
    '',
    company,
    pick(['Staff Engineer', 'Engineering Manager', 'Principal Data Scientist', 'Product Lead']),
    `http://www.linkedin.com/jobs/view/${4000000000 + i}`,
    'resume.pdf',
    '',
  ]);
  const saved = employers.slice(8, 13).map((company, i) => [
    new Date(now - (i * 13 + 2) * DAY).toLocaleString('en-US'),
    `http://www.linkedin.com/jobs/view/${4100000000 + i}`,
    pick(['Head of Platform', 'Senior ML Engineer', 'Director of Data']),
    company,
  ]);
  const follows = employers.slice(0, 14).map((company, i) => [
    company,
    new Date(now - (i * 40 + 9) * DAY).toUTCString().replace('GMT', 'UTC'),
  ]);

  const shares = Array.from({ length: 6 }, (_, i) => [
    stamp(now - (i * 47 + 11) * DAY),
    `https://www.linkedin.com/feed/update/urn:li:share:sample${i}`,
    `Some notes on ${pick(TOPICS)} after a week of digging into it.`,
    '',
    '',
    'MEMBER_NETWORK',
  ]);
  const reactions = Array.from({ length: 40 }, (_, i) => [
    stamp(now - Math.floor(rnd() * 700) * DAY),
    pick(['LIKE', 'PRAISE', 'EMPATHY', 'INTEREST']),
    `https://www.linkedin.com/feed/update/urn:li:activity:sample${i}`,
  ]);

  return [
    {
      name: 'messages.csv',
      content: csv(
        [
          'CONVERSATION ID', 'CONVERSATION TITLE', 'FROM', 'SENDER PROFILE URL', 'TO',
          'RECIPIENT PROFILE URLS', 'DATE', 'SUBJECT', 'CONTENT', 'FOLDER', 'ATTACHMENTS',
        ],
        messages,
      ),
    },
    {
      name: 'Invitations.csv',
      content: csv(
        ['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl'],
        invitations,
      ),
    },
    {
      name: 'Endorsement_Received_Info.csv',
      content: csv(
        [
          'Endorsement Date', 'Skill Name', 'Endorser First Name', 'Endorser Last Name',
          'Endorser Public Url', 'Endorsement Status',
        ],
        endorsements,
      ),
    },
    {
      name: 'Jobs/Job Applications.csv',
      content: csv(
        [
          'Application Date', 'Contact Email', 'Contact Phone Number', 'Company Name',
          'Job Title', 'Job Url', 'Resume Name', 'Question And Answers',
        ],
        applications,
      ),
    },
    {
      name: 'Jobs/Saved Jobs.csv',
      content: csv(['Saved Date', 'Job Url', 'Job Title', 'Company Name'], saved),
    },
    {
      name: 'Company Follows.csv',
      content: csv(['Organization', 'Followed On'], follows),
    },
    {
      // The member-id suffix matters: the importer matches these files by the
      // exact shape LinkedIn emits, "Shares_885394707.csv".
      name: 'Shares_1000000001.csv',
      content: csv(
        ['Date', 'ShareLink', 'ShareCommentary', 'SharedUrl', 'MediaUrl', 'Visibility'],
        shares,
      ),
    },
    {
      name: 'Reactions_1000000001.csv',
      content: csv(['Date', 'Type', 'Link'], reactions),
    },
  ];
}
