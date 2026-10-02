export type Book = {
  t: string; a: string; g: string; r: number; n: string; p: number; date: string; pub: string; price: string;
  m: string; f: string; c: [string, string, string]; ts?: string; d: string;
};
export type Row = { title: string; books: Book[] };

export const ROWS: Row[] = [
  { title: "New this month", books: [
    { t: "The Salt Orchard", a: "Mara Vell", g: "Literary fiction", r: 4.6, n: "1.8K", p: 312, date: "Sep 8, 2026", pub: "Fernwood Press", price: "$12.99", m: "sun", f: "serif", c: ["#1f4d4a", "#f3e6c8", "#e8a33d"],
      d: "When a storm floods the last apple orchard on the Breton coast, three estranged sisters come home to save what’s left of their grandmother’s trees. Vell writes about inheritance, salt-burned soil, and the slow work of forgiving the people who stayed." },
    { t: "Night Shift at the Observatory", a: "Theo Akinde", g: "Mystery", r: 4.4, n: "960", p: 288, date: "Sep 15, 2026", pub: "Halyard Books", price: "$10.99", m: "rings", f: "sans", ts: "10.5cqw", c: ["#151a3d", "#ece8ff", "#7f74ff"],
      d: "An astronomer on the graveyard shift spots a star that shouldn’t be there, and a colleague who isn’t where he said he’d be. A quiet, clever mystery set among telescopes and thermoses of bad coffee." },
    { t: "Field Notes on Leaving", a: "June Okafor", g: "Essays", r: 4.7, n: "2.3K", p: 224, date: "Sep 1, 2026", pub: "Marrow Street", price: "$14.99", m: "arch", f: "serif", c: ["#d5e2cc", "#1f3326", "#b5523b"],
      d: "Twelve essays about moving cities, ending friendships, and the objects we carry across both. Okafor is funny, exact, and never sentimental, even when she’s packing her mother’s kitchen." },
    { t: "Glass Harbor", a: "Rin Takeda", g: "Science fiction", r: 4.3, n: "3.1K", p: 416, date: "Sep 22, 2026", pub: "Tidewater", price: "$11.99", m: "waves", f: "sans", c: ["#0d5a8a", "#ffffff", "#7fe0d8"],
      d: "In a floating city that rises and sinks with the tide, a dock engineer discovers the sea wall was never meant to keep the water out. Part heist, part climate thriller, all momentum." },
    { t: "The Cartographer’s Daughter", a: "Elena Brask", g: "Historical fiction", r: 4.5, n: "5.4K", p: 464, date: "Sep 29, 2026", pub: "Fernwood Press", price: "$13.99", m: "grid", f: "serif", ts: "10cqw", c: ["#6b2b2b", "#f2dcc2", "#d9a441"],
      d: "Lisbon, 1755. In the weeks after the great earthquake, a mapmaker’s daughter finishes her father’s last commission, redrawing a city that no longer matches any map." },
  ]},
  { title: "Short enough for a weekend", books: [
    { t: "Night Bus Sonata", a: "Ida Lunden", g: "Novella", r: 4.2, n: "640", p: 132, date: "Jun 10, 2026", pub: "Pellucid Editions", price: "$7.99", m: "split", f: "serif", c: ["#2d2a32", "#f5c4b8", "#f08a6c"],
      d: "A pianist and a night bus driver share one cigarette break a week for a year. A novella told almost entirely in those ten-minute conversations." },
    { t: "How to Fix a Bicycle", a: "Sam Oduya", g: "Memoir", r: 4.8, n: "1.2K", p: 176, date: "Apr 14, 2026", pub: "Marrow Street", price: "$9.99", m: "block", f: "sans", c: ["#f2c230", "#1d1d1b", "#d23f2f"],
      d: "After his father’s stroke, Oduya teaches him to ride again, one repaired part at a time. A short, generous memoir about patience, grease, and second attempts." },
    { t: "Lantern Fish", a: "Paz Moreno", g: "Short stories", r: 4.4, n: "420", p: 168, date: "May 5, 2026", pub: "Tidewater", price: "$8.99", m: "grid", f: "serif", c: ["#062b3a", "#ffe7a3", "#3fd0c9"],
      d: "Nine stories set in deep water, real and otherwise: a submarine cook, a drowned village that still rings its bell, a marine biologist who stops answering emails." },
    { t: "A Year Indoors", a: "Hana Mirel", g: "Poetry", r: 4.6, n: "380", p: 96, date: "Feb 2, 2026", pub: "Pellucid Editions", price: "$6.99", m: "sun", f: "serif", c: ["#c9d8e8", "#1d2c45", "#f6f8fb"],
      d: "Poems written over twelve months of staying put: a balcony garden, a neighbor’s radio through the wall, the specific grey of February." },
    { t: "Ninety-Nine Doors", a: "Felix Arand", g: "Fantasy", r: 4.1, n: "2.0K", p: 204, date: "Jul 21, 2026", pub: "Halyard Books", price: "$8.99", m: "stripes", f: "sans", c: ["#5a2a82", "#ffe0f4", "#ff9ad5"],
      d: "A house with ninety-nine doors, one of which opens somewhere new each night. A brisk, playful fantasy that knows exactly how long to be." },
  ]},
  { title: "Start a new series", books: [
    { t: "The Iron Archive", a: "K. L. Marsh", g: "Epic fantasy", r: 4.5, n: "12K", p: 592, date: "Oct 3, 2025", pub: "Halyard Books", price: "$9.99", m: "rings", f: "serif", c: ["#2f3b2f", "#ead9a6", "#c79a3b"],
      d: "Book one of the Archive Cycle. A junior librarian discovers that the empire’s records are being rewritten overnight, and that she’s the only one who remembers the originals." },
    { t: "Cold Mooring", a: "Ana Voss", g: "Thriller", r: 4.3, n: "7.7K", p: 384, date: "Jan 12, 2026", pub: "Tidewater", price: "$10.99", m: "split", f: "sans", c: ["#15181c", "#f2f2f2", "#e63946"],
      d: "Inspector Lina Haar, book one. A yacht drifts into Rotterdam harbor with no crew aboard and the engine still warm." },
    { t: "Orbital Season", a: "Dev Raman", g: "Science fiction", r: 4.6, n: "4.9K", p: 448, date: "Mar 3, 2026", pub: "Fernwood Press", price: "$11.99", m: "sun", f: "sans", c: ["#f26b3a", "#1b1030", "#ffd166"],
      d: "Station Kepler, book one. On a mining station where a year lasts four days, a medic races to contain an outbreak before the next supply ship refuses to dock." },
    { t: "The Tea Merchant’s Ledger", a: "Yuki Sato", g: "Cozy mystery", r: 4.4, n: "3.3K", p: 304, date: "Nov 18, 2025", pub: "Marrow Street", price: "$8.99", m: "block", f: "serif", ts: "11cqw", c: ["#7a9a6d", "#fffaf0", "#2f4a2a"],
      d: "Kyoto Tea House Mysteries, book one. A missing page from a century-old ledger points to a murder nobody ever reported." },
    { t: "Wolfsong Valley", a: "Ren Halloway", g: "Fantasy romance", r: 4.2, n: "9.1K", p: 512, date: "Aug 5, 2025", pub: "Pellucid Editions", price: "$9.99", m: "waves", f: "serif", c: ["#23324a", "#f0e2d0", "#d69a5a"],
      d: "Valley Courts, book one. A ranger and the heir she was sent to watch must cross the valley together before the first snow seals the passes." },
  ]},
];

export const bookId = (b: Book) => b.t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const BOOKS = new Map(ROWS.flatMap((r) => r.books.map((b) => [bookId(b), b] as const)));
