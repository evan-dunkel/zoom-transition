// Sample content for the portfolio prototype: four projects, then writing and
// experiments. The studio, clients and results are invented.

export type ArtKind = "phones" | "type" | "bars" | "tiles" | "orbits" | "spring" | "shelf" | "breathe" | "draft";
/** A generated image: a composition and its colours (ground, figure, accent). */
export type ArtSpec = { kind: ArtKind; c: [string, string, string] };
export type Figure = { art: ArtSpec; caption: string };
export type Section = { heading?: string; paragraphs: string[]; quote?: string; figure?: Figure };

export type Project = {
  id: string;
  title: string;
  kicker: string;
  client: string;
  year: string;
  facts: [string, string][];
  summary: string;
  art: ArtSpec;
  sections: Section[];
};

export type Writing = {
  id: string;
  kind: "Essay" | "Experiment" | "Note";
  title: string;
  date: string;
  minutes: number;
  summary: string;
  art: ArtSpec;
  sections: Section[];
};

export const PROJECTS: Project[] = [
  {
    id: "tidewater-transit",
    title: "Tidewater Transit",
    kicker: "Trip planning for a coastal city’s ferries and buses",
    client: "Tidewater Transit Authority",
    year: "2025",
    facts: [
      ["Role", "Lead product designer"],
      ["Team", "2 designers, 5 engineers, 1 researcher"],
      ["Timeline", "9 months"],
      ["Platform", "iOS, Android, web"],
    ],
    summary:
      "Riders were planning trips across three apps and a printed timetable. We folded ferries, buses and the tide-dependent water taxi into one planner that tells you when to leave, not just which way to go.",
    art: { kind: "phones", c: ["#0d5a8a", "#f4f8fb", "#7fe0d8"] },
    sections: [
      {
        heading: "The problem with routes",
        paragraphs: [
          "Most trip planners answer the question “which way?”. Our riders already knew which way. What they didn’t know was whether the 7:40 ferry would run with the tide that morning, or whether the bus would wait for it.",
          "Interviews with forty commuters kept returning to the same moment: standing at the door, checking three apps, deciding whether to run.",
        ],
        figure: { art: { kind: "phones", c: ["#e3eef4", "#ffffff", "#0d5a8a"] }, caption: "Early concepts put the departure time, not the route, at the top of every result." },
      },
      {
        heading: "Leave by, not arrive by",
        paragraphs: [
          "The planner leads with one instruction: leave in 6 minutes. The route, transfers and fare sit underneath and open on a tap.",
          "Live data from the ferry operator moves that number as conditions change. A notification fires only if it moves by more than two minutes, because a planner that buzzes for every thirty-second drift gets muted by Wednesday.",
        ],
        figure: { art: { kind: "bars", c: ["#0b2f47", "#14466a", "#7fe0d8"] }, caption: "How far a departure can drift before we interrupt someone, tuned with a month of real delays." },
      },
      {
        heading: "What shipped",
        paragraphs: [
          "The planner launched in spring 2025. The printed timetable is still on the pier, so the app’s schedule view matches it line for line: nobody has to relearn where the 7:40 is.",
        ],
      },
    ],
  },
  {
    id: "fernwood-reader",
    title: "Fernwood Reader",
    kicker: "An e-reading app for an independent press",
    client: "Fernwood Press",
    year: "2024",
    facts: [
      ["Role", "Product designer"],
      ["Team", "1 designer, 3 engineers"],
      ["Timeline", "6 months"],
      ["Platform", "iOS, iPadOS"],
    ],
    summary:
      "Fernwood publishes about twenty books a year and wanted readers to buy them direct. The app is a small shop and a careful reading room, with a store that feels like browsing the table at the front of a bookshop.",
    art: { kind: "type", c: ["#1f4d4a", "#f3e6c8", "#e8a33d"] },
    sections: [
      {
        heading: "Typesetting for screens",
        paragraphs: [
          "Every Fernwood title is set by hand for print. We kept the press’s typefaces and margins and built the reading view around them: hanging punctuation, real small caps, and line lengths that adapt to the device but never pass seventy characters.",
        ],
        figure: { art: { kind: "type", c: ["#f6f2e9", "#2a2723", "#b5523b"] }, caption: "The house serif at reading size, with its optical size switched per screen." },
      },
      {
        heading: "A shelf that opens",
        paragraphs: [
          "Browsing borrows from the press’s own shop. Covers face out on short shelves, and tapping one opens it in place: the cover flies from the shelf into the book’s page and opens as it arrives. Dragging down closes it back onto its shelf.",
          "Each shelf holds five books, sized so the next cover always peeks in from the edge. That peek did more for browsing than any “see all” link we tried.",
        ],
        figure: { art: { kind: "shelf", c: ["#efe6d6", "#1f4d4a", "#e8a33d"] }, caption: "Shelves of five, with the sixth cover peeking in." },
      },
      {
        heading: "Results",
        paragraphs: [
          "Within a year, direct sales became a steady share of the press’s income. Most of the email we got from readers was about the typography.",
        ],
      },
    ],
  },
  {
    id: "atlas-clinic",
    title: "Atlas Clinic",
    kicker: "Scheduling for a network of community clinics",
    client: "Atlas Community Health",
    year: "2024",
    facts: [
      ["Role", "Senior product designer"],
      ["Team", "3 designers, 8 engineers"],
      ["Timeline", "14 months"],
      ["Platform", "Web"],
    ],
    summary:
      "Front-desk staff juggled walk-ins, appointments and interpreters across six clinics in a shared spreadsheet. Atlas gives each desk one view of the day and turns rescheduling into a drag instead of a phone tree.",
    art: { kind: "bars", c: ["#e9efe6", "#ffffff", "#2f6b4f"] },
    sections: [
      {
        heading: "Designing for the busiest hour",
        paragraphs: [
          "We spent two weeks at front desks before drawing anything. Between 8 and 10 a.m. a desk checks in a patient every ninety seconds, often with a phone to one ear.",
          "That set the rule for every interaction: if it needs two hands or a second screen, it won’t get used.",
        ],
        figure: { art: { kind: "bars", c: ["#2f3b2f", "#3d4d3d", "#c7e6a3"] }, caption: "Arrivals by quarter hour at the largest clinic." },
      },
      {
        heading: "One timeline per room",
        paragraphs: [
          "The day view is a stack of timelines, one per room and provider. Appointments are blocks you can drag between rooms. While you drag, Atlas checks interpreter and equipment availability and shades the slots that won’t work before you let go.",
        ],
        figure: { art: { kind: "tiles", c: ["#f3f6f1", "#2f6b4f", "#e2a13b"] }, caption: "The appointment block in its states: booked, arrived, running late, needs an interpreter." },
      },
      {
        heading: "Rollout",
        paragraphs: [
          "Atlas replaced the spreadsheet one clinic at a time over five months. We kept a printed day sheet as an export, because some desks still like paper at the end of the day.",
        ],
      },
    ],
  },
  {
    id: "kiln",
    title: "Kiln",
    kicker: "A design system for a handmade ceramics marketplace",
    client: "Kiln",
    year: "2023",
    facts: [
      ["Role", "Design systems lead"],
      ["Team", "2 designers, 2 engineers"],
      ["Timeline", "8 months"],
      ["Platform", "Web, iOS"],
    ],
    summary:
      "Kiln sells work from four hundred potters. The system had to make every product page consistent while letting glazes, textures and studio stories stay as varied as the pots.",
    art: { kind: "tiles", c: ["#d9cbb8", "#6b4f3a", "#3f7f86"] },
    sections: [
      {
        heading: "Quiet components, loud photography",
        paragraphs: [
          "Components carry almost no colour of their own. Each page takes a tint from its lead photo, sampled at build time, so a celadon bowl and a raku jar each sit on a ground that suits them.",
        ],
        figure: { art: { kind: "tiles", c: ["#e4ece9", "#3f7f86", "#c46a3c"] }, caption: "Core components on a ground sampled from a celadon glaze." },
      },
      {
        heading: "Tokens potters can read",
        paragraphs: [
          "Sellers edit their own studio pages, so the tokens are named in their words: clay, slip, glaze, kiln. An engineer writes glaze-strong; a seller picks “Glaze” from a menu. Both get the same colour.",
          "Within two quarters every product and studio page ran on the system, and new features shipped without one-off CSS.",
        ],
      },
    ],
  },
];

export const WRITING: Writing[] = [
  {
    id: "interruptible-by-default",
    kind: "Essay",
    title: "Interruptible by default",
    date: "Sep 2026",
    minutes: 6,
    summary: "Every transition should be able to change its mind halfway. Notes on building animations you can grab.",
    art: { kind: "orbits", c: ["#151a3d", "#ece8ff", "#7f74ff"] },
    sections: [
      {
        paragraphs: [
          "Watch someone use a phone for a minute and count how often they change their mind mid-gesture. They open something, see it isn’t what they wanted, and close it before it has finished opening. They start a swipe and pull it back.",
          "Interfaces that make them wait for the first animation to end before the second can begin feel slow, however short the animations are.",
        ],
        quote: "An animation that has to finish before you can act is a loading screen with better manners.",
      },
      {
        heading: "Carry the speed",
        paragraphs: [
          "Making a transition interruptible is mostly bookkeeping. At the moment of interruption, take whatever is on screen, where it is and how fast it’s moving, and start the next spring from exactly there. Springs make this natural: they take a starting velocity, so a close that turns into an open keeps its momentum instead of stopping dead.",
          "The hard part is everything you were tempted to fake. A shadow that only exists at the end, a crossfade timed to a duration: each one has to be expressed as a function of where things are, not of how long they’ve been going.",
        ],
        figure: { art: { kind: "orbits", c: ["#0f1230", "#cfc8ff", "#ff9ad5"] }, caption: "Each card keeps its own position and velocity, so any of them can turn around." },
      },
    ],
  },
  {
    id: "springs-you-can-feel",
    kind: "Experiment",
    title: "Springs you can feel",
    date: "Aug 2026",
    minutes: 4,
    summary: "Matching SwiftUI’s duration-and-bounce springs on the web, and why I stopped tuning stiffness by hand.",
    art: { kind: "spring", c: ["#fff6e5", "#2d2a32", "#f08a6c"] },
    sections: [
      {
        paragraphs: [
          "Stiffness and damping are honest numbers, but nobody can picture them. Duration and bounce are numbers you can feel: half a second, a little bounce.",
          "SwiftUI’s springs are defined that way, and they convert exactly to physical ones: stiffness is (2π / duration)², damping is 4π(1 − bounce) / duration. Hand those to any spring solver and a value tuned on an iPhone feels the same in a browser.",
        ],
        figure: { art: { kind: "spring", c: ["#2d2a32", "#f5c4b8", "#f08a6c"] }, caption: "Duration 0.5 s, bounce 0.15: the curve every transition in this portfolio uses." },
      },
      {
        heading: "What changed",
        paragraphs: [
          "Tuning sessions got shorter. A designer can say “a bit quicker, less bounce” and the numbers move the same way. Closing runs 1.75 times faster than opening, which reads as the interface getting out of your way.",
        ],
      },
    ],
  },
  {
    id: "the-shelf-is-the-interface",
    kind: "Essay",
    title: "The shelf is the interface",
    date: "Jun 2026",
    minutes: 7,
    summary: "What rebuilding a bookshop zoom taught me about letting the page do the navigation.",
    art: { kind: "shelf", c: ["#f2dcc2", "#6b2b2b", "#d9a441"] },
    sections: [
      {
        paragraphs: [
          "In a good bookshop you never feel like you’re navigating. You pick something up, read the back, put it down where it was, and your eye is already on the next one. The shelf holds your place for you.",
          "On screens we usually throw that away. Tapping a book replaces the shelf with a page, and the back button returns you to a shelf that has to be redrawn and re-scrolled.",
        ],
        quote: "The best back button is putting the thing back where you found it.",
      },
      {
        heading: "Putting it back",
        paragraphs: [
          "A zoom that grows the book out of its spot, and shrinks it back into the same spot, keeps the shelf in your head the whole time. You always know where you are, because you watched yourself get there.",
          "It also changes what a close should look like. When only the book you were holding flies back, and the rest of the shelf waits behind, dimmed, the close feels like setting something down rather than tidying up a room.",
        ],
      },
    ],
  },
  {
    id: "type-that-breathes",
    kind: "Experiment",
    title: "Type that breathes",
    date: "Apr 2026",
    minutes: 3,
    summary: "A variable font whose weight follows how fast you scroll. Mostly a toy, partly a lesson in restraint.",
    art: { kind: "breathe", c: ["#d5e2cc", "#1f3326", "#b5523b"] },
    sections: [
      {
        paragraphs: [
          "The idea: as you scroll faster, headings get lighter, as if they were being blown thin. When you stop, they settle back to their weight.",
          "It’s delightful for about ten seconds. After that it’s a reason to stop reading. I kept one piece of it: headings settle into their weight as they come to rest, once, and then they stay still.",
        ],
        figure: { art: { kind: "breathe", c: ["#1f3326", "#d5e2cc", "#e8a33d"] }, caption: "Weight from 200 to 800, mapped to scroll speed. Kept for the demo, removed from the site." },
      },
    ],
  },
  {
    id: "case-studies-people-finish",
    kind: "Note",
    title: "Case studies people finish",
    date: "Feb 2026",
    minutes: 5,
    summary: "Most portfolio case studies are read for forty seconds. A structure that respects that.",
    art: { kind: "draft", c: ["#e6e9f0", "#ffffff", "#2457d6"] },
    sections: [
      {
        paragraphs: [
          "The people reading your case study are hiring, and they have a stack of them. Give them the whole project in the first screen: what it was, what you did, and what changed.",
          "Everything after that is for the reader who decided to stay. Keep each section to one decision: what you knew, what you tried, what you chose and why.",
        ],
        quote: "Lead with the outcome. The process is the reward for reading on.",
      },
      {
        heading: "End with the next one",
        paragraphs: [
          "When someone reaches the end, don’t make them find their way back to the index. Put the next project right there. In this portfolio, keep scrolling past the end of a piece and the next one slides up.",
        ],
        figure: { art: { kind: "draft", c: ["#1c1c1e", "#2c2c30", "#7aa2ff"] }, caption: "First screen: title, role, outcome. Everything else below the fold." },
      },
    ],
  },
];

export const PROJECT_BY_ID = new Map(PROJECTS.map((p) => [p.id, p]));
export const WRITING_BY_ID = new Map(WRITING.map((w) => [w.id, w]));
