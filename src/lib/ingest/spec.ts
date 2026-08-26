// ---------------------------------------------------------------------------
// Documentation constants for the Import page.
//
// Pure data with no imports, so client components can describe the import
// formats without pulling the parsers (and therefore `node:fs`) into the
// browser bundle.
// ---------------------------------------------------------------------------

/** LinkedIn archive files the importer recognizes. */
export const SUPPORTED_FILES = [
  'Connections.csv',
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
  'Invitations.csv',
];

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
