/**
 * DEMONSTRATION CONTENT
 *
 * Everything in this file is invented sample copy for design and development.
 * The places, publications, people and figures are fictional. None of it is
 * real reporting, and the interface labels it as sample content wherever it
 * appears. It is only used when Supabase is not configured.
 *
 * Photographs are hotlinked from Unsplash under the Unsplash License.
 */
import type { Category, EditionStatus, StoryRole } from '../lib/types'

export interface DemoStory {
  category: Category
  headline: string
  summary: string
  source: string
  /** Days before the edition date that the "original" was published. */
  age: number
  photo?: { id: string; alt: string }
  research?: { originalTitle: string; excerpt: string; rationale: string; claims: string[] }
  role?: StoryRole
}

export interface DemoEdition {
  /** Days relative to today: 0 is today's edition, -1 yesterday's. */
  offset: number
  status: EditionStatus
  stories: DemoStory[]
}

export const unsplash = (id: string, width = 1200) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=72`

export const DEMO_EDITIONS: DemoEdition[] = [
  {
    offset: 0,
    status: 'published',
    stories: [
      {
        category: 'nature',
        headline: 'After twenty years of patient work, the Alder runs clear again',
        summary:
          'Two decades ago the Alder River was written off as too polluted to recover. This week, surveyors counted young salmon in its upper reaches for the first time in living memory. The turnaround came from unglamorous work: replanted banks, a rebuilt treatment plant, and hundreds of volunteers who logged water samples every month. “Nobody did anything heroic,” one of them said. “We just kept turning up.”',
        source: 'The Valley Courier',
        age: 1,
        photo: { id: '1506744038136-46273834b3fb', alt: 'A calm river reflecting pine forest and granite cliffs at dusk' },
      },
      {
        category: 'health',
        headline: 'A one-dollar paper test is catching infections days earlier',
        summary:
          'A network of rural clinics has finished its first full year using a paper-strip test that flags a common childhood infection from a single drop of blood. It costs about a dollar, needs no electricity and gives a result in fifteen minutes. Nurses report that children now start treatment an average of three days sooner, and hospital admissions for severe cases have fallen by nearly a third.',
        source: 'Meridian Health Journal',
        age: 2,
        photo: { id: '1532094349884-543bc11b234d', alt: 'Clear glass laboratory flasks on a white bench' },
      },
      {
        category: 'humanity',
        headline: 'The night-bus drivers who became a neighbourhood’s safety net',
        summary:
          'When the last late-night pharmacy in Port Wren closed, drivers on the number 14 route started carrying a list: who needed a prescription collected, who lived alone, who had not been seen that week. What began as a favour is now a formal partnership with the local health service. Forty drivers have completed first-aid training, and the route’s regulars have a name for it — the bus that checks in.',
        source: 'The Harbour Ledger',
        age: 1,
      },
      {
        category: 'science',
        headline: 'Schoolchildren map a patch of sky nobody had catalogued',
        summary:
          'A citizen-science project has published its first star catalogue, built from 60,000 observations by students in rural schools. Using small donated telescopes and a free phone app, the classes charted a faint region of the southern sky that large surveys had skipped. Astronomers who checked the work found its accuracy close to professional standards, and three newly listed variable stars now carry the names of the schools that spotted them.',
        source: 'Northfield Science Review',
        age: 1,
        photo: { id: '1444703686981-a3abbc4d4fe3', alt: 'A lone figure standing beneath the Milky Way' },
      },
      {
        category: 'progress',
        headline: 'A farming town now runs on its own sunshine, and sells the rest',
        summary:
          'Marrow Creek, population 4,200, has switched on a community-owned solar field that covers the whole town’s daytime electricity. Residents bought shares for as little as twenty dollars, and the surplus is sold to the grid, with proceeds paying for the school bus and longer library hours. Household bills are expected to fall by around a fifth. Two neighbouring towns have already asked for the plans.',
        source: 'Open Field Report',
        age: 3,
        photo: { id: '1509391366360-2e959784a276', alt: 'Rows of solar panels in a field under a bright, cloudy sky' },
      },
    ],
  },
  {
    offset: -1,
    status: 'published',
    stories: [
      {
        category: 'nature',
        headline: 'Sea turtle nests reach a thirty-year high on a once-empty beach',
        summary:
          'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began three decades ago. The beach saw fewer than fifty nests a year before nearby towns agreed to dim their seafront lights and fishing crews adopted nets that let turtles escape. Hatchlings are now reaching the water in numbers local guides say they have never seen, and the night patrols are run entirely by volunteers.',
        source: 'Tidewater Post',
        age: 1,
        photo: { id: '1437622368342-7a3d73a34c8f', alt: 'A sea turtle swimming through clear blue water' },
      },
      {
        category: 'progress',
        headline: 'Every child in the district now gets a library card by default',
        summary:
          'A school district has started issuing library cards automatically at enrolment, removing the paperwork that kept many families from signing up. In the first term, borrowing by under-twelves rose 64 per cent, with the steepest increases in neighbourhoods that previously borrowed least. Late fines were abolished at the same time. Librarians say the most common question from new members is whether the books are really free.',
        source: 'Lantern Weekly',
        age: 2,
      },
      {
        category: 'health',
        headline: 'A weekly text from a nurse helps patients finish their treatment',
        summary:
          'A year-long trial found that a simple weekly text message from a nurse helped people with a long-term lung condition stay on their medication. Among the 2,300 patients who received the messages, 81 per cent completed the full course, compared with 62 per cent of those who did not. The programme costs less than a cup of coffee per patient each month, and every clinic in the region will offer it by spring.',
        source: 'Meridian Health Journal',
        age: 2,
        photo: { id: '1576091160399-112ba8d25d1d', alt: 'A clinician in a white coat holding a phone' },
      },
      {
        category: 'humanity',
        headline: 'A repair café has just fixed its ten-thousandth broken thing',
        summary:
          'It was a toaster. Volunteers at the Saturday repair café in Linden Row have now mended ten thousand household items since opening in a borrowed church hall, keeping an estimated forty tonnes out of landfill. Retired engineers work alongside teenagers learning to solder, and nobody is charged. The founder says the repairs matter less than the queue, where neighbours who had never spoken now save each other seats.',
        source: 'The Harbour Ledger',
        age: 1,
        photo: { id: '1559027615-cd4628902d4a', alt: 'A volunteer in a red shirt, seen from behind, at a community event' },
      },
      {
        category: 'science',
        headline: 'A battery made mostly from salt passes its toughest test yet',
        summary:
          'Engineers report that a prototype sodium-based battery kept 92 per cent of its capacity after five thousand charge cycles, a durability milestone for a design that avoids scarce metals. Because its main ingredient is abundant and cheap, the technology is aimed at storing wind and solar power for homes and small grids. Independent laboratories will now repeat the tests before a pilot production line opens next year.',
        source: 'Northfield Science Review',
        age: 3,
      },
    ],
  },
  {
    offset: -2,
    status: 'published',
    stories: [
      {
        category: 'nature',
        headline: 'Foxes are raising cubs in the Harrow hills for the first time in forty years',
        summary:
          'Wildlife cameras in the Harrow uplands have recorded fox cubs for the first time in four decades, a sign that a long effort to reconnect fragments of woodland is working. Farmers planted 300 kilometres of hedgerow to link the remaining copses, creating corridors that voles, owls and now foxes are using. Ecologists say a returning predator is one of the clearest signals that the smaller life beneath it is recovering too.',
        source: 'The Valley Courier',
        age: 1,
        photo: { id: '1474511320723-9a56873867b5', alt: 'A red fox standing alert on a snowy ridge' },
      },
      {
        category: 'science',
        headline: 'A new map of the seabed finds mountains nobody knew were there',
        summary:
          'A survey ship has finished charting a stretch of deep ocean the size of a small country, revealing more than a hundred undersea mountains that appear on no existing map. The peaks, some taller than three kilometres, shelter cold-water corals and sponges. The data is being released freely so the area can be considered for protection, and so shipping and cable routes can steer around its most fragile habitats.',
        source: 'Northfield Science Review',
        age: 2,
      },
      {
        category: 'humanity',
        headline: 'A city hands its empty lots to the neighbours, and gardens follow',
        summary:
          'Three years after a mid-sized city offered residents free leases on vacant lots, 212 of them have become gardens, orchards and playgrounds. A review published this week found that streets with a converted lot reported more neighbours knowing each other by name, and that the plots grew some eighteen tonnes of vegetables last summer, much of it given away. The scheme costs less than the mowing it replaced.',
        source: 'Lantern Weekly',
        age: 1,
        photo: { id: '1542601906990-b4d3fb778b09', alt: 'Cupped hands holding a young green plant' },
      },
      {
        category: 'health',
        headline: 'A long-feared childhood disease is declared gone from a whole region',
        summary:
          'Health officials have confirmed that a mosquito-borne illness which once filled children’s wards has not been transmitted anywhere in the Sorrel Basin for three consecutive years, meeting the threshold for elimination. The result follows fifteen years of bed-net distribution, village health workers and rapid testing. Clinics that once saw hundreds of cases every rainy season are being converted to offer vaccinations and maternal care instead.',
        source: 'Meridian Health Journal',
        age: 2,
      },
      {
        category: 'nature',
        headline: 'A forest the size of a city is protected for good',
        summary:
          'A coalition of villages, the regional government and a land trust has signed an agreement that permanently protects 48,000 hectares of old-growth forest. The communities who live there will manage it, with funding guaranteed for thirty years of ranger salaries and monitoring. The forest stores as much carbon as a million cars emit in a year, and is home to at least nine species found nowhere else.',
        source: 'Open Field Report',
        age: 3,
        photo: { id: '1497436072909-60f360e1d4b1', alt: 'Dense green forest meeting turquoise water, seen from above' },
      },
    ],
  },
  {
    // Tomorrow's edition, waiting for the editor. Never visible to readers.
    offset: 1,
    status: 'draft',
    stories: [
      {
        category: 'nature',
        headline: 'A tree once down to its last hundred is growing wild again',
        summary:
          'Foresters have planted the ten-thousandth sapling of a native hardwood that had dwindled to barely a hundred mature trees. The seedlings were raised from seed collected by local schoolchildren and grown in a village nursery. Survival rates after the first two summers stand at 87 per cent, well above expectations, and the oldest of the new trees flowered this year, the first natural step towards a forest that can renew itself.',
        source: 'The Valley Courier',
        age: 1,
        photo: { id: '1518495973542-4542c06a5843', alt: 'Sunlight breaking through the canopy of a large old tree' },
        research: {
          originalTitle: 'Ten-thousandth sapling planted in hardwood recovery scheme',
          excerpt:
            'The restoration partnership said the 10,000th sapling was planted on Tuesday. Survival after two summers was recorded at 87%, against a forecast of 60%. Several six-year-old trees flowered this season.',
          rationale: 'Concrete, measurable conservation result with a clear before and after. Single regional source.',
          claims: ['“Barely a hundred mature trees” — confirm the baseline figure', '87% two-summer survival rate'],
        },
      },
      {
        category: 'health',
        headline: 'A hearing test that fits in a pocket reaches villages that never had one',
        summary:
          'Community health workers have screened 40,000 people for hearing loss using a phone-based test that needs no clinic and no soundproof booth. One in nine of those screened was referred for hearing aids or simple ear treatment, most of them for the first time in their lives. Teachers in the pilot districts report that children once thought to be struggling at school are now following lessons.',
        source: 'Meridian Health Journal',
        age: 2,
        research: {
          originalTitle: 'Phone-based audiometry screening: results from a 40,000-person community programme',
          excerpt:
            'Of 40,112 people screened, 4,480 (11.2%) were referred for further care. Validation against booth audiometry showed 91% sensitivity. Teacher-reported outcomes were collected by survey.',
          rationale: 'Meaningful access-to-care story with published numbers. The school outcomes are survey-based, so they are worded cautiously.',
          claims: ['40,000 screened and “one in nine” referred (11.2%)', 'Teacher reports are survey data, not measured results'],
        },
      },
      {
        category: 'humanity',
        headline: 'A town pays off every school-lunch debt, then keeps going',
        summary:
          'A collection started by a retired dinner lady has cleared the lunch debts of every family in her town’s six schools. Donations kept arriving after the target was met, so the fund now quietly covers any child whose account runs dry. Head teachers say fewer pupils are skipping lunch, and the bakery that hosted the first collection tin has added a second, for school shoes.',
        source: 'The Harbour Ledger',
        age: 1,
        research: {
          originalTitle: 'Lunch debt wiped out across six schools after retired cook’s appeal',
          excerpt:
            'The appeal passed its target within three weeks. The school trust confirmed all outstanding lunch balances had been cleared and a standing fund established.',
          rationale: 'Warm, specific act of community care with confirmation from the school trust.',
          claims: ['All six schools cleared — confirmed by the trust?', 'No amount is given in the source; none has been added'],
        },
      },
      {
        category: 'science',
        headline: 'Divers find a coral reef thriving in water thought too warm for it',
        summary:
          'Marine biologists surveying a remote lagoon have documented a healthy reef living in temperatures that bleach most corals. Early genetic tests suggest its corals host unusually heat-tolerant algae. The team has stressed that this is no substitute for cooling the oceans, but samples are already being grown in nurseries to learn whether the trait can help restore damaged reefs elsewhere.',
        source: 'Northfield Science Review',
        age: 2,
        photo: { id: '1544551763-46a013bb70d5', alt: 'A scuba diver beside a dense school of yellow fish on a reef' },
        research: {
          originalTitle: 'Heat-tolerant reef documented in isolated lagoon system',
          excerpt:
            'Water temperatures at the site exceed typical bleaching thresholds for several months a year. Preliminary sequencing indicates dominance of a thermally tolerant symbiont. Authors caution against over-interpretation.',
          rationale: 'Genuine discovery with appropriate caveats kept in the summary. Findings are preliminary.',
          claims: ['Genetic results are described as “early” — keep that wording', 'Nursery work: confirm it has started rather than being planned'],
        },
      },
      {
        category: 'progress',
        headline: 'A night train between two capitals returns after thirty years',
        summary:
          'The first sleeper service in three decades has left on a route that had become one of the region’s busiest short-haul flights. Tickets for the opening month sold out in two days. The operator says a full train replaces roughly four flights’ worth of passengers, and the refurbished carriages were rebuilt at a rail works that had been due to close, saving two hundred jobs.',
        source: 'Open Field Report',
        age: 1,
        research: {
          originalTitle: 'Sleeper service relaunches; first month sells out',
          excerpt:
            'The inaugural departure left on Friday evening. The operator said tickets for the first month sold out within 48 hours. Carriages were refurbished at the regional works.',
          rationale: 'Tangible low-carbon transport progress with a jobs angle. Operator-supplied comparison figures.',
          claims: ['“Roughly four flights” is the operator’s own estimate', 'Two hundred jobs saved — find a second source'],
        },
      },
      {
        role: 'backup',
        category: 'nature',
        headline: 'A tiny forest now grows behind every school in the county',
        summary:
          'The last of 94 schools has planted its “tiny forest”, a tennis-court-sized plot of densely packed native trees tended by pupils. The oldest plots, now four years in, are already taller than the children who planted them and have recorded more than 300 species of insects and birds. Teachers use them as outdoor classrooms, and several have become the only woodland within walking distance.',
        source: 'Lantern Weekly',
        age: 2,
        photo: { id: '1441974231531-c6227db76b6e', alt: 'A sunlit path through tall woodland' },
        research: {
          originalTitle: 'County completes school tiny-forest programme',
          excerpt: 'All 94 schools now have a planted plot. Monitoring at the oldest sites has logged over 300 species.',
          rationale: 'Good nature and education story; held as a backup because the edition already leads with trees.',
          claims: ['94 schools', '300 species recorded at the oldest sites only'],
        },
      },
      {
        role: 'backup',
        category: 'science',
        headline: 'A five-dollar sensor warns farmers of frost hours before it arrives',
        summary:
          'An open-source frost sensor designed by agricultural students has been installed on 1,200 small farms. It texts growers when conditions are heading towards a damaging freeze, giving them several hours to cover seedlings or light orchard heaters. In its first season, participating farms reported losing around half as much of their early crop as in the previous year. The designs are free for anyone to build.',
        source: 'Northfield Science Review',
        age: 3,
        research: {
          originalTitle: 'Low-cost frost alert network completes first season',
          excerpt: 'Installed at 1,200 sites. Self-reported early-crop losses were roughly 50% lower than the prior season.',
          rationale: 'Practical innovation with open designs. Loss figures are self-reported and compare different weather years.',
          claims: ['Crop-loss comparison is self-reported and year-on-year — treat as indicative'],
        },
      },
      {
        role: 'backup',
        category: 'humanity',
        headline: 'Retired teachers are answering a free homework phone line',
        summary:
          'Every weekday evening, a rota of sixty retired teachers takes calls from children stuck on their homework. The line began in one town’s library and now covers a whole region, handling about four hundred calls a week. Maths is the most common subject. Organisers say many callers ring back simply to report how the test went, and several volunteers have asked for extra shifts.',
        source: 'The Harbour Ledger',
        age: 4,
        research: {
          originalTitle: 'Homework helpline expands across region',
          excerpt: 'The volunteer-run line reports around 400 calls weekly and a rota of 60 former teachers.',
          rationale: 'Charming and credible, but the original is four days old, which is at the edge of the freshness window.',
          claims: ['Source is four days old', 'Call volume is supplied by the organisers'],
        },
      },
    ],
  },
]
