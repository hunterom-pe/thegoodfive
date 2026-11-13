/**
 * The curated reading list. Edit freely: add outlets you trust, remove ones
 * you don't. `trust` (1–3) nudges selection and breaks ties between
 * duplicate reports. A feed that fails to load is skipped, never fatal.
 *
 * All URLs were returning valid feeds when this list was written
 * (November 2026); feeds do move, so check the run log now and then.
 */
export interface Feed {
  name: string
  url: string
  trust: 1 | 2 | 3
}

export const FEEDS: Feed[] = [
  // Outlets that set out to report constructive news
  { name: 'Reasons to be Cheerful', url: 'https://reasonstobecheerful.world/feed/', trust: 3 },
  { name: 'The Guardian (The Upside)', url: 'https://www.theguardian.com/world/series/the-upside/rss', trust: 3 },
  { name: 'Good News Network', url: 'https://www.goodnewsnetwork.org/feed/', trust: 2 },
  // General reporting, in the areas where good news tends to live
  { name: 'BBC News (Science & Environment)', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', trust: 3 },
  { name: 'BBC News (Health)', url: 'https://feeds.bbci.co.uk/news/health/rss.xml', trust: 3 },
  { name: 'NPR (Health)', url: 'https://feeds.npr.org/1128/rss.xml', trust: 3 },
  { name: 'Nature', url: 'https://www.nature.com/nature.rss', trust: 3 },
  { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml', trust: 2 },
  { name: 'Mongabay', url: 'https://news.mongabay.com/feed/', trust: 3 },
  { name: 'Yale Environment 360', url: 'https://e360.yale.edu/feed.xml', trust: 3 },
  // Institutions (primary sources: treat announcements as claims to check)
  { name: 'World Health Organization', url: 'https://www.who.int/rss-feeds/news-english.xml', trust: 3 },
  { name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', trust: 3 },
  { name: 'Our World in Data', url: 'https://ourworldindata.org/atom.xml', trust: 3 },
]

/**
 * GDELT searches for broad global discovery. `tone>` asks GDELT for
 * positively toned coverage; the AI still judges every result on its merits.
 */
export const GDELT_QUERIES: string[] = [
  '(breakthrough OR "clinical trial" OR vaccine OR cure OR eliminated) (success OR approved OR milestone) sourcelang:english tone>4',
  '(conservation OR rewilding OR "endangered species" OR reforestation OR restored) (recovery OR returns OR record OR protected) sourcelang:english tone>4',
  '(discovery OR "scientists have" OR researchers OR astronomers OR "new species") (first OR breakthrough OR confirmed OR "published in") sourcelang:english tone>3',
  '(volunteers OR community OR donated OR rescued OR "renewable energy" OR literacy) (milestone OR first OR celebrates OR record) sourcelang:english tone>5',
]
