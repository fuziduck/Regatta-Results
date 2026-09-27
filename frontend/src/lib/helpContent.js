export const HELP_TOPICS = [
  {
    id: "help", title: "Help centre", match: (path) => path === "/help", intro: "Find page-specific instructions, searchable answers and role-based walkthroughs.", items: [
      ["Contextual help", "Open Help from a page header or console to see options and actions relevant to that page."],
      ["Quick starts", "The Officer and Admin guides are interactive checklists. Mark steps complete as you work through them."],
      ["FAQ search", "Search the full FAQ for topics such as scoring, race-day workflow, subscriptions, security and backups."]
    ]
  },
  {
    id: "faq", title: "Frequently asked questions", match: (path) => path === "/faq", intro: "Search or browse answers grouped by topic. Expand a question to read its answer.", items: [
      ["Search questions", "Search matches the category, question and answer text. Clear the search to browse every category."],
      ["Race-day codes", "Outcome abbreviations follow sailing race-scoring conventions. Ask your club race officer if you are unsure how a code applies to a particular result."]
    ]
  },
  {
    id: "directory", title: "Club directory", match: (path) => path === "/", intro: "The directory is the public starting point for finding clubs, fleets and published racing.", items: [
      ["Club cards", "Choose a club to browse its classes and latest published results. A class card opens directly to that class and, when available, its latest series."],
      ["Season selector", "Switch between current, past and planned seasons. The directory reflects what has been published or scheduled for the selected year."],
      ["Clubs / classes filter", "Use the selector above the directory to browse by club or by class across the SailScore system."],
      ["Boat search", "Search for a boat by name or sail number to open its profile and racing history."],
      ["Officials", "Officials opens the sign-in page, or your console when you are already signed in."]
    ]
  },
  {
    id: "club", title: "Club results", match: (path) => /^\/club\/[^/]+(?:\/series\/|$)/.test(path), intro: "A club page brings together the club's classes, series results, race notices and upcoming events.", items: [
      ["Class and series tabs", "Choose a class to see its available series. Select a series to review the standings and its published races."],
      ["Standings", "Standings are computed from published race results and the series scoring rules. Open a race to inspect its published finishing order."],
      ["Race-day notice", "When an officer publishes a race-day notice, the course, special rules and safety information appear on the club page."],
      ["Calendar", "Use the calendar link to browse planned races by month. Only upcoming scheduled races appear there."],
      ["Official Notice Board", "The notice board contains official club notices and attached documents. Use its subscription option to receive new notices by email."]
    ]
  },
  {
    id: "calendar", title: "Race calendar", match: (path) => /\/calendar\/?$/.test(path), intro: "Browse future scheduled races across a club by month and date.", items: [
      ["Month and day groups", "Each card shows the class, race number, series and scheduled start time. The planned count includes all upcoming races shown."],
      ["Results", "Use Results in the header to return to the club's public results page. The calendar is read-only; race setup is done in the Race Officer console."]
    ]
  },
  {
    id: "race", title: "Race results", match: (path) => /\/race\//.test(path), intro: "A race page shows the published result, scoring details and links back to its series.", items: [
      ["Result rows", "Boats are ranked by the published result. Codes such as DNF, DSQ and DNC are scoring outcomes, not finishing positions."],
      ["Scoring display", "For handicap races, switch between available corrected-time or rating views when the result provides more than one scoring mode."],
      ["Series link", "Return to the series standings to compare this race with other races and discards."]
    ]
  },
  {
    id: "regatta", title: "Regatta results", match: (path) => /\/(regatta|competition)\//.test(path), intro: "Regatta pages group the event overview with class-by-class race results.", items: [
      ["Overview", "Review the event summary, participating classes and available event information."],
      ["Results", "Choose Results to browse the scored races and standings for the event. A class filter narrows a large event to one fleet."]
    ]
  },
  {
    id: "class", title: "Class results", match: (path) => path.startsWith("/class/"), intro: "Class pages collect fleet history, championships and participating clubs.", items: [
      ["Series and seasons", "Use the available season or series controls to move between published class results."],
      ["Club and fleet links", "A one-design class may combine results from several clubs. Follow a club or series link to see its own results and schedule."]
    ]
  },
  {
    id: "boats", title: "Boat directory", match: (path) => path === "/boats", intro: "Find boats and open their SailScore profiles.", items: [
      ["Search", "Enter a boat name or sail number and choose a matching result. The boat page shows known details and race history."],
      ["Profiles", "Boat profiles can include results from multiple classes, clubs and years. Select a season or series to narrow the history."]
    ]
  },
  {
    id: "boat", title: "Boat profile", match: (path) => path.startsWith("/boat/"), intro: "A boat profile brings together its identity and available racing history.", items: [
      ["Season and club selectors", "Use the selectors to move through the boat's available years, clubs and racing series."],
      ["Results and standings", "Open a race or championship link for the full result. SailScore only shows history that has been added or published."]
    ]
  },
  {
    id: "notice-board", title: "Official Notice Board", match: (path) => path.endsWith("/notice-board"), intro: "The public notice board is the official home for club notices and documents.", items: [
      ["Notice cards", "Open a notice to read its published content and view or download its attachments."],
      ["Subscribe to ONB", "Enter an email address to receive new official notice documents. No SailScore account is needed; follow the verification email to activate the subscription."]
    ]
  },
  {
    id: "officer", title: "Race Officer", match: (path) => path === "/officer", intro: "Use Race day to set up scheduled races, record results and publish them for competitors.", items: [
      ["Scheduled races", "Choose the race day. Open a scheduled slot to create/open its race console; the Split option turns the slot into a mini-series day."],
      ["Create race", "Use this only when no scheduled slot exists. Choose a class and series, then create a single race or a mini-series day."],
      ["Race console: sign-on", "Tap each boat that is racing. Unselected boats score DNC. All and Clear change the whole selection; applying it to other races on the day skips races that already have finishes."],
      ["Race console: finish entry", "One-design: tap boats in finishing order. Handicap: choose Live taps, Finish times or Elapsed times; results are ordered by corrected time. Use the provisional table to fix positions or record committee codes."],
      ["Race status", "Setup is editable work in progress; Provisional is awaiting confirmation; Published makes the result visible to competitors. Validate before publishing. Published results can be recalled while the season is open."],
      ["Race-day notice", "Add the start time, course, special rules and life-jacket requirement, then publish the notice to the club page."],
      ["Mini-series batch", "Enter finishes for several short races in one view, review each race, and publish the group when it is ready. You can open a full race console for detailed corrections."],
      ["New Notice", "Create and publish an Official Notice Board item using the guided steps. A race-linked notice can be associated with the selected race."],
      ["Top-bar menu", "View site opens the public club page. Admin is available to admin/webmaster accounts. Change passcode, theme and Exit are in the console menu on smaller screens."]
    ]
  },
  {
    id: "admin", title: "Race Admin", match: (path) => path === "/admin", intro: "The admin console configures club fleets, season scoring, notices and user access.", items: [
      ["Classes", "Create or edit a class, its scoring method, divisions and planned series. Class setup is the foundation for boats and race schedules."],
      ["Boats", "Maintain boat names, sail numbers and fleet membership. Correct boat records before scoring so results link to the right profile."],
      ["Championship", "Configure a class championship, planned races, scoring and discards. Published races feed the live standings."],
      ["Club Championship", "Configure the club-wide championship that combines eligible fleet results according to its settings."],
      ["Regattas", "Create and manage event groupings and their scheduled classes/races."],
      ["Notice Board", "Organize notice-board areas and publish, edit or withdraw official notices and their attachments."],
      ["Historic Results", "Correct imported or earlier race results, review season standings and lock/archive a completed season. Unlock only when an authorized correction is needed."],
      ["Logins", "Create and manage individual club accounts and roles. Give each person only the access needed for their duties."],
      ["Subscriptions", "Review club results and notice-board email subscriptions and their delivery status."],
      ["Club", "Manage the club identity/icon and enable or disable race-day notices and the Official Notice Board."],
      ["Security", "Set up two-factor authentication for your account. Use a passphrase-backed recovery method and keep it private."],
      ["Activity (webmaster)", "Review administrator actions in the audit log. This tab is visible to webmasters only."],
      ["Download backup", "Download a club backup before major changes. Store it securely; encrypted backups can contain credential material."]
    ]
  },
  {
    id: "notice", title: "Create a notice", match: (path) => path === "/notice/new", intro: "The notice wizard guides you from notice type to publication.", items: [
      ["Type and method", "Choose the notice category and whether to write it in SailScore or upload a prepared document."],
      ["Details and attachments", "Complete the notice fields and add supporting files. Review the preview carefully before publication."],
      ["Publish", "Publishing makes the notice available on the club's Official Notice Board and may email subscribers. Verify the club and notice text before confirming."]
    ]
  },
  {
    id: "webmaster", title: "Webmaster", match: (path) => path === "/webmaster", intro: "Webmaster tools manage the SailScore installation and clubs across the system.", items: [
      ["System areas", "Use the console tabs to manage system-wide settings, clubs and services. Club-level changes should normally be handled in that club's Admin console."],
      ["Backups and restore", "Download a club or full-system backup regularly and verify that it can be retained safely. Restore replaces data in the selected backup scope; confirm scope and passphrase before proceeding."],
      ["Security", "Limit webmaster access to trusted operators, use a unique passcode and enable two-factor authentication where available."]
    ]
  },
  {
    id: "login", title: "Sign in", match: (path) => ["/login", "/forgot-password", "/reset-password"].includes(path), intro: "Sign in with the credentials provided by your club administrator.", items: [
      ["Forgot passcode", "Request a reset email for the account address. Use the most recent reset link before it expires."],
      ["Two-factor code", "If enabled, enter the current authenticator code after your passcode. Check your device clock if a valid code is rejected."]
    ]
  }
];

export const FAQS = [
  { category: "Getting started", question: "What is SailScore?", answer: "SailScore publishes club sailing schedules, race results, series standings and official notices. Competitors can browse public pages without an account; officials sign in to record results or manage a club." },
  { category: "Getting started", question: "Do competitors need an account?", answer: "No. Public results and notices are available without signing in. An email subscription is optional and is verified by email." },
  { category: "Getting started", question: "How do I find my club, class or boat?", answer: "Start in the club directory, use its Clubs / classes selector, or search for a boat by name or sail number. Open a card to see its available racing history." },
  { category: "Getting started", question: "Why can't I see a race or series?", answer: "SailScore only displays data that has been scheduled or entered. Unpublished race results are private to officials; check the selected season, club and class, or ask the club race officer." },
  { category: "Results and scoring", question: "When do results become public?", answer: "An officer publishes results from the race console after checking them. Setup and provisional results are not the final public result; published results appear on the club and series pages." },
  { category: "Results and scoring", question: "What do DNC, DNS, DNF, RET and DSQ mean?", answer: "These are race-result codes: DNC means did not come to the starting area; DNS did not start; DNF did not finish; RET retired; DSQ disqualified. The racing rules define the exact scoring treatment." },
  { category: "Results and scoring", question: "How are handicap results ordered?", answer: "The race console records a finish time or elapsed time and uses the series/class rating to calculate corrected results. The race officer should confirm the correct scoring mode and timing data." },
  { category: "Results and scoring", question: "How do discards affect standings?", answer: "When the series rules allow discards, the scoring engine excludes the eligible worst race scores according to the configured schedule. The standings identify counted totals; ask the club administrator about its policy." },
  { category: "Results and scoring", question: "Why is a boat missing from a race?", answer: "The boat may not be in the series membership, may be marked DNC, or may not yet have been added to that fleet. Ask a race officer or administrator to check the race sign-on and series boats." },
  { category: "Results and scoring", question: "Can a published result be corrected?", answer: "While a season is open, an authorized officer/admin can recall a result, correct it and publish it again. Locked or archived seasons need an authorized administrator to reopen them, and changes should follow the club's rules." },
  { category: "Race day", question: "What is the difference between Setup, Provisional and Published?", answer: "Setup is being entered, Provisional indicates a result awaiting confirmation, and Published makes the result public. Use Validate results and review penalties before publishing." },
  { category: "Race day", question: "How do I record a one-design finish?", answer: "In the race console, tap each boat as it finishes. The tap sequence assigns places; correct any mistakes in the provisional results table before publishing." },
  { category: "Race day", question: "How do I record handicap finishes?", answer: "Choose Live taps, Finish times or Elapsed times. Enter accurate times for each boat; SailScore reorders the result using corrected time. Live and finish-time modes rely on the race start time." },
  { category: "Race day", question: "What happens when I clear a boat selection?", answer: "A boat not selected as racing is scored DNC. Clear marks every boat in that race as not racing; use it carefully, and sign on the actual fleet before recording finishes." },
  { category: "Race day", question: "What is a mini-series day?", answer: "It groups several short races on one day for batch entry. Choose whether they combine into one daily result or count as separate races in the main series, according to the series plan." },
  { category: "Race day", question: "Can I change a result after publishing?", answer: "If the season is open, recall the published race from the Officer console, make the correction, validate and publish again. Another user editing at the same time may require you to reload the latest version first." },
  { category: "Notices and email", question: "How do I subscribe to results or notices?", answer: "Use the subscription button on the relevant public page, enter your email address, then follow the verification email. Check spam if it does not arrive." },
  { category: "Notices and email", question: "Where are official documents published?", answer: "Published official notices and their attachments appear on that club's Official Notice Board. Clubs can enable or disable the board in Admin → Club." },
  { category: "Accounts and safety", question: "I can't sign in. What should I do?", answer: "Check that you are using the correct account and passcode, then use Forgot passcode. If the account or email is wrong, contact your club administrator; never share reset links or authenticator codes." },
  { category: "Accounts and safety", question: "What is two-factor authentication?", answer: "It adds a time-based code from an authenticator app after your passcode. Enable it in the console Security area and keep recovery details private and safe." },
  { category: "Accounts and safety", question: "What does a season lock do?", answer: "A lock freezes the completed season standings as a final snapshot and prevents ordinary result edits. Archive a season when it is permanently closed; unlocking should be exceptional and audited." },
  { category: "Accounts and safety", question: "How should I use backups?", answer: "Administrators should download backups before important maintenance and retain them somewhere secure. A restore replaces the data in the backup's scope, so verify whether it is a club or full-system backup before restoring." },
  { category: "Troubleshooting", question: "Why did my save fail with a conflict?", answer: "Another official may have changed the same race since your page loaded. Reload the latest result and reapply only the edits that are still needed; do not repeatedly submit an outdated version." },
  { category: "Troubleshooting", question: "Why didn't I receive a subscription email?", answer: "First verify the email address and confirm the subscription using its verification link. Check spam/junk and ask the club administrator to review subscription delivery status if the issue continues." },
  { category: "Troubleshooting", question: "Who can help with incorrect race data?", answer: "Contact the club's race officer for a race-day scoring issue, or a club administrator for fleet, series, account or notice-board setup. Include the club, class, race date and boat sail number." }
];

export const QUICK_STARTS = {
  officer: {
    title: "Race Officer quick start",
    intro: "A race-day checklist: set up the race, record accurate finishes, check the result and publish it.",
    steps: [
      ["Open the race day", "Sign in and open Race Officer. Select the correct club if prompted, then choose the date. Open a scheduled race slot; create a race only if the schedule has no matching slot."],
      ["Check race details", "Confirm class, series, race number and start time. If your club uses race-day notices, record the course, special rules and life-jacket requirement."],
      ["Sign on the fleet", "Tap the boats that are racing. Unselected boats score DNC. Confirm series membership and use All/Clear only when you intend to change the full selection."],
      ["Start and record finishes", "For one-design fleets, tap boats in finishing order. For handicap fleets, choose Live taps, Finish times or Elapsed times and enter complete times. Enter any penalty or committee decision explicitly."],
      ["Review and validate", "Check places, sail numbers, finish times and outcome codes. Use the provisional table for corrections and Check results to surface validation issues."],
      ["Publish", "Mark the result Provisional if it is awaiting confirmation. Publish when it is confirmed; competitors can then see the result and updated standings."],
      ["Correct a published race", "For an open season, recall the result, make the correction, validate and publish again. If a conflict appears, reload before continuing."]
    ]
  },
  admin: {
    title: "Race Admin quick start",
    intro: "Set up a club in the right order: fleets, boats, season structure, access and public information.",
    steps: [
      ["Set up classes", "In Classes, create each fleet and choose its scoring method and any divisions. Check time/rating requirements before creating series."],
      ["Add boats", "In Boats, maintain boat names and sail numbers and associate each boat with the right class. Resolve duplicates before the season starts."],
      ["Plan the season", "In Championship and Club Championship, configure series, race schedules, scoring and discards. Use Regattas for event groupings. Confirm race dates and planned counts with the sailing programme."],
      ["Manage notices", "In Notice Board, organize areas and publish official notices/documents. In Club, enable the boards the club intends to use."],
      ["Create logins", "In Logins, give each race officer an individual account with the least role access needed. Provide credentials privately and ask users to change temporary passcodes."],
      ["Secure the account", "Open Security and configure two-factor authentication. Store recovery details safely and keep webmaster credentials separate."],
      ["Back up and verify", "Download a club backup before major changes. Check the public club page, planned calendar and a sample result before race day."],
      ["Close the season", "Review historical results and standings, correct discrepancies while the season is open, then lock the final season and archive it when appropriate."]
    ]
  }
};

export const getHelpTopic = (pathname) => HELP_TOPICS.find((topic) => topic.match(pathname)) || HELP_TOPICS[0];
