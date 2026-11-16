import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./pipeline/pipeline.ts', () => ({ runPipeline: vi.fn() }))
import { runPipeline } from './pipeline/pipeline.ts'
import { executeRun } from './store.ts'

// One clock for the whole draft job (finding, writing, saving, claim checks), with time kept back to record the outcome.
// Scaled down: the whole job is 1,000 ms and the reserve is a tenth of it, so work must stop at 900 ms.
const story = { id: 's1', role: 'primary', position: 1, headline: 'A research advance', summary: 'Researchers report a useful advance.', category: 'science', source_name: 'ScienceDaily', source_url: 'https://www.sciencedaily.com/releases/example.htm', source_published_at: '2026-11-16T00:00:00Z', source_material: 'Researchers report a useful advance.', ai_rationale: 'A useful advance', image_rights_confirmed: true }

function fakeDb() {
  const writes: { table: string; body: unknown }[] = []
  return {
    writes,
    db: {
      from(table: string) {
        let op = 'select'
        let body: unknown
        const q: any = new Proxy({}, {
          get(_t, key) {
            if (key === 'then') return (resolve: any) => {
              if (op === 'update') writes.push({ table, body })
              const data = table === 'discovery_runs' ? { trigger: 'schedule' } : table === 'editions' ? { id: 'e1', edition_date: '2026-11-16', status: 'draft', stories: [story] } : []
              return Promise.resolve({ data, error: null }).then(resolve)
            }
            return (...args: unknown[]) => { if (key === 'update') { op = 'update'; body = args[0] } return q }
          },
        })
        return q
      },
      async rpc() { return { data: 'e1', error: null } },
    },
  }
}
const outcome = (writes: { table: string; body: any }[]) => writes.filter((w) => w.table === 'discovery_runs').map((w) => w.body).at(-1)

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('RUN_DEADLINE_MS', '1000')
  vi.stubEnv('CLAIM_CHECK_GAP_MS', '0')
  vi.stubEnv('ALERT_WEBHOOK_URL', '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.mocked(runPipeline).mockReset() })

describe('the draft job has one deadline', () => {
  it('stops slow claim checks at the job limit, keeps the saved draft and still records the outcome in time', async () => {
    vi.mocked(runPipeline).mockImplementation(async () => { await new Promise((r) => setTimeout(r, 600)); return { stories: [story], stats: {} } as never })
    const { db, writes } = fakeDb()
    let finished = false
    // The verifier ignores cancellation entirely and would take until 1,100 ms.
    const verify = async () => { await new Promise((r) => setTimeout(r, 500)); return { verdict: 'verified' as const, issues: [] } }
    const run = executeRun(db as never, 'run1', '2026-11-16', () => {}, { verify }).then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(finished).toBe(true)
    await run
    expect(outcome(writes)).toMatchObject({ status: 'succeeded' })
    // The late verdict is discarded rather than stored as if it were a real check.
    expect(writes.filter((w) => w.table === 'stories')).toEqual([])
  })

  it('skips the draft-time checks when the pipeline used the whole budget, and fails a run that never returns', async () => {
    let seen: AbortSignal | undefined
    vi.mocked(runPipeline).mockImplementation(((o: { signal?: AbortSignal }) => { seen = o.signal; return new Promise(() => {}) }) as never)
    const { db, writes } = fakeDb()
    const run = executeRun(db as never, 'run1', '2026-11-16', () => {}, { verify: async () => ({ verdict: 'verified', issues: [] }) })
    await vi.advanceTimersByTimeAsync(1000)
    await run
    expect(outcome(writes)).toMatchObject({ status: 'failed', error: expect.stringContaining('took longer') })
    expect(seen?.aborted).toBe(true) // unfinished pipeline work is told to stop
  })

  it('stores nothing from claim checks that start with almost no time left', async () => {
    vi.mocked(runPipeline).mockImplementation(async () => { await new Promise((r) => setTimeout(r, 880)); return { stories: [story], stats: {} } as never })
    const verify = vi.fn(async () => { await new Promise((r) => setTimeout(r, 300)); return { verdict: 'verified' as const, issues: [] } })
    const { db, writes } = fakeDb()
    const run = executeRun(db as never, 'run1', '2026-11-16', () => {}, { verify })
    await vi.advanceTimersByTimeAsync(1000)
    await run
    expect(writes.filter((w) => w.table === 'stories')).toEqual([])
    expect(outcome(writes)).toMatchObject({ status: 'succeeded' })
  })
})
