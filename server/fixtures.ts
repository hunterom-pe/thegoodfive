import type { StoredEdition, StoredStory } from './autopublish.ts'

export const NOW = new Date('2026-11-14T14:00:00Z') // 7:00 AM in Phoenix on 14 November 2026
export const DATE = '2026-11-14'
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const FILLER = ' The report describes the programme in detail, quotes local residents and officials, and explains how the results were measured over several seasons by independent monitors.'

/** Five different, realistic good-news items. Each summary is the opening of its own source text, so everything in it is supported. */
const BODIES: { headline: string; category: string; body: string }[] = [
  { headline: 'Rangers count record turtle nests on the Calder coast', category: 'nature',
    body: 'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996. The beach saw fewer than fifty nests a year before nearby towns agreed to dim their seafront lights and fishing crews adopted nets that let turtles escape. Volunteers led by Maria Santos walk the beach each night, recording every nest and protecting it from foxes and flooding. Hatchlings are now reaching the water in numbers local guides say they have never seen, according to the Calder Coast Trust.' },
  { headline: 'Salmon return to the restored Alder river after twenty years', category: 'nature',
    body: 'Surveyors counted 312 young salmon in the upper reaches of the Alder River this week, the first time juvenile fish have been recorded there in twenty years. The recovery followed replanted banks, a rebuilt treatment plant and monthly water sampling by volunteers from the Alder Valley Society. Engineer Priya Nair said the river now meets the national standard for clean water at every monitoring point, a result the council described as the best since testing started in 2004.' },
  { headline: 'Mobile library van lends 9,000 books to rural families', category: 'humanity',
    body: 'A mobile library van serving the town of Linden Row has lent 9,000 books since it began its rounds in March. The van visits eleven villages every week, stopping at village halls, schools and doctors surgeries. Librarian Tom Okafor said children borrowed more than half of the books, and several families joined the library for the first time. The Linden Row Library Friends raised the money for the van, and the county council now plans a second route next spring.' },
  { headline: 'Community solar field now covers the whole town’s daytime power', category: 'progress',
    body: 'The community-owned solar field at Marrow Creek now covers all of the town’s daytime electricity, supplying homes, the school and the fire station. Residents bought shares starting at twenty dollars, and surplus power is sold to the grid to pay for the school bus. Mayor Elena Ruiz said household bills are expected to fall by about a fifth, and two neighbouring towns have asked the Marrow Creek Energy Cooperative for its plans.' },
  { headline: 'Night buses become a safety net for lonely neighbours', category: 'humanity',
    body: 'Drivers on the number 14 night bus in Port Wren now carry a list of neighbours who need a prescription collected or a friendly check-in. What began as a favour is now a formal partnership with the Harbour Health Service, and forty drivers have completed first-aid training. Driver Amina Yusuf said regulars have a name for the route, the bus that checks in, and the scheme will extend to the number 9 service in the new year.' },
  { headline: 'Community fridges now feed 400 families each week across the city', category: 'humanity',
    body: 'A network of community fridges across the city now feeds about 400 families each week, according to the Eastside Food Alliance. Shops and bakeries donate surplus food, and volunteers restock the fridges every morning. Coordinator Grace Mwangi said the scheme has kept more than ten tonnes of food from landfill since January, and three more neighbourhoods have asked to join the network this winter.' },
  { headline: 'Phone app screens thousands of villagers for hearing loss', category: 'health',
    body: 'Health workers in the Sorrel district have screened 5,200 people for hearing loss using a phone app that needs no soundproof booth. About one in nine was referred for hearing aids or ear treatment, most for the first time. Nurse Joseph Banda said teachers have noticed children following lessons more easily, and the district health office plans to extend the programme to 12 more villages.' },
  { headline: 'Wild bees return to a restored meadow in the Harrow hills', category: 'nature',
    body: 'Ecologists from the Harrow Wildlife Trust recorded 41 species of wild bee in a restored meadow this summer, up from 12 species when the project began in 2021. Farmers sowed native wildflowers along 30 kilometres of field edges, and children from three local schools helped monitor the insects. Ecologist Hannah Reid said the meadow is now one of the richest bee habitats in the county.' },
]

export function story(i: number, over: Partial<StoredStory> = {}): StoredStory {
  const b = BODIES[i % BODIES.length]
  const material = b.body + FILLER.repeat(3)
  return {
    id: `s${i}`,
    role: i < 5 ? 'primary' : 'backup',
    position: i < 5 ? i + 1 : i - 4,
    headline: b.headline,
    summary: b.body.split(/\s+/).slice(0, 72).join(' ').replace(/[,;]$/, '') + '.',
    category: b.category,
    sourceName: 'BBC News',
    sourceUrl: `https://www.bbc.co.uk/news/articles/c${i}`,
    sourcePublishedAt: hoursAgo(10),
    sourceMaterial: material,
    aiRationale: 'A concrete, well-sourced local success.',
    ...over,
  }
}

/** A distinct backup story (bodies 5, 6 and 7 are not among the usual five). */
export function backup(i: number, over: Partial<StoredStory> = {}): StoredStory {
  return story(i, { id: `b${i}`, role: 'backup', position: i - 4, sourceName: 'The Guardian', sourceUrl: `https://www.theguardian.com/world/2026/nov/14/story-${i}`, ...over })
}

export const edition = (stories: StoredStory[], status: StoredEdition['status'] = 'draft'): StoredEdition => ({ id: 'ed-1', date: DATE, status, stories })
export const fiveGood = () => [0, 1, 2, 3, 4].map((i) => story(i))
