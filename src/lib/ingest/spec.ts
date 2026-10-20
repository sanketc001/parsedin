// ---------------------------------------------------------------------------
// Documentation constants for the Import page.
//
// Pure data with no imports, so client components can describe the import
// formats without pulling the parsers (and therefore `node:fs`) into the
// browser bundle.
// ---------------------------------------------------------------------------

/**
 * LinkedIn archive files the importer recognizes, grouped the way the export
 * itself splits: your profile, your network, and everything you did.
 *
 * The activity group is only present in the *Complete* export — LinkedIn's
 * "Basic" download omits messages, ads and security history entirely.
 */
export const SUPPORTED_GROUPS: { title: string; note: string; files: string[] }[] = [
  {
    title: 'Your profile',
    note: 'Full history for the account owner.',
    files: [
      'Profile.csv',
      'Email Addresses.csv',
      'Positions.csv',
      'Education.csv',
      'Skills.csv',
      'Certifications.csv',
      'Volunteering.csv',
      'Languages.csv',
      'Projects.csv',
      'Honors.csv',
      'Verifications.csv',
    ],
  },
  {
    title: 'Your network',
    note: 'One person per row — name, current role, profile URL.',
    files: [
      'Connections.csv',
      'Invitations.csv',
      'Endorsement_Received_Info.csv',
      'Endorsement_Given_Info.csv',
      'Member_Follows.csv',
      'Notes.csv',
    ],
  },
  {
    title: 'Your activity',
    note: 'Complete export only. This is what turns the contact list into a record of relationships.',
    files: [
      'messages.csv',
      'Shares.csv',
      'Comments.csv',
      'Reactions.csv',
      'Votes.csv',
      'Company Follows.csv',
      'Learning.csv',
      'Events.csv',
    ],
  },
  {
    title: 'Job search',
    note: 'Cross-referenced against the network on the Jobs page.',
    files: [
      'Jobs/Job Applications.csv',
      'Jobs/Saved Jobs.csv',
      'Jobs/Job Seeker Preferences.csv',
      'SavedJobAlerts.csv',
    ],
  },
  {
    title: 'Ads & security',
    note: 'What LinkedIn inferred about you, and who signed in.',
    files: [
      'Ad_Targeting.csv',
      'Inferences_about_you.csv',
      'Ads Clicked.csv',
      'LAN Ads Engagement.csv',
      'Logins.csv',
      'Security Challenges.csv',
    ],
  },
];

/** Flat list, for the "recognized files" summary. */
export const SUPPORTED_FILES = SUPPORTED_GROUPS.flatMap((g) => g.files);

/** The shape the enriched-profile importer accepts, shown as a live example. */
export const ENRICHED_TEMPLATE = {
  profiles: [
    {
      fullName: 'Ada Example',
      linkedinUrl: 'https://www.linkedin.com/in/ada-example/',
      headline: 'Staff ML Engineer',
      location: 'Bengaluru, India',
      industry: 'Software Development',
      connectionDegree: 1,
      summary: 'Works on ranking systems.',
      positions: [
        {
          title: 'Staff ML Engineer',
          company: 'Google',
          startDate: '2021-04',
          endDate: null,
          isCurrent: true,
          location: 'Bengaluru',
          description: 'Search ranking.',
        },
        {
          title: 'Engagement Manager',
          company: 'McKinsey & Company',
          startDate: '2017-07',
          endDate: '2021-03',
        },
      ],
      education: [
        {
          school: 'Indian Institute of Technology Bombay',
          degree: 'B.Tech',
          fieldOfStudy: 'Computer Science',
          startDate: '2013',
          endDate: '2017',
        },
      ],
      skills: ['Machine Learning', 'Python', 'Ranking'],
      certifications: [
        { name: 'TensorFlow Developer', authority: 'Google', startDate: '2020-06' },
      ],
      volunteering: [
        { organization: 'Teach For India', role: 'Mentor', cause: 'Education' },
      ],
      languages: [{ name: 'English', proficiency: 'Native' }],
      projects: [{ name: 'OpenRank', description: 'Open-source ranking toolkit' }],
      honors: [{ title: "Director's Medal", issuer: 'IIT Bombay', date: '2017' }],
    },
  ],
};
