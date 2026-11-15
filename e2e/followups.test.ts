import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { editionToday } from '../server/store'
import { postgresAvailable, startPg, type PgInstance } from './localdb'

/**
 * "What happened next?" relationships, against the real migrations in a throwaway Postgres:
 * who may create, approve, change and remove them, and exactly what the public can see.
 */
const describeIf = postgresAvailable() ? describe : describe.skip

const EDITOR = '00000000-0000-4000-8000-0000000000e1'
const READER = '00000000-0000-4000-8000-0000000000a1' // signed in, but not an editor

const day = (offset: number) => new Date(Date.parse(`${editionToday()}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)

describeIf('follow-up relationships', () => {
  let pg: PgInstance
  const ids: Record<string, string> = {}

  beforeAll(() => {
    pg = startPg()
    pg.exec(`insert into auth.users (id, email) values ('${EDITOR}', 'editor@example.test'), ('${READER}', 'reader@example.test'); insert into public.editors (user_id) values ('${EDITOR}');`)
  })
  afterAll(() => pg?.stop())

  /** One edition with one primary story (and optionally a backup). Status is set after the stories go in. */
  function edition(key: string, date: string, status: 'draft' | 'published', withBackup = false) {
    pg.exec(`insert into public.editions (edition_date, status) values ('${date}', 'draft')`)
    const add = (role: string, pos: number, k: string) => {
      const row = pg.query(`insert into public.stories (edition_id, role, position, category, headline, summary, source_name, source_url, source_published_at)
        select id, '${role}', ${pos}, 'nature', 'Story ${k}', 'Summary ${k}', 'BBC News', 'https://www.bbc.co.uk/news/${k}', now() - interval '1 day' from public.editions where edition_date = '${date}' returning id`)[0] as { id: string }
      ids[k] = row.id
    }
    add('primary', 1, key)
    if (withBackup) add('backup', 1, `${key}-backup`)
    if (status === 'published') pg.exec(`update public.editions set status = 'published', published_at = now() where edition_date = '${date}'`)
  }

  /** Run SQL as a signed-in user. */
  const as = (uid: string, sql: string) => pg.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);\n${sql}`, 'authenticated')
  const link = (earlier: string, later: string, by = EDITOR, explanation = 'The sanctuary was formally extended a year later.', url = 'https://www.bbc.co.uk/news/follow-up') =>
    as(by, `insert into public.story_followups (earlier_story, later_story, explanation, source_url) values ('${ids[earlier]}', '${ids[later]}', '${explanation.replace(/'/g, "''")}', '${url}')`)
  const approve = (earlier: string, later: string, by = EDITOR) => as(by, `update public.story_followups set status = 'approved' where earlier_story = '${ids[earlier]}' and later_story = '${ids[later]}'`)
  const row = (earlier: string, later: string) => pg.query(`select status, created_by, approved_by from public.story_followups where earlier_story = '${ids[earlier]}' and later_story = '${ids[later]}'`)[0] as { status: string; created_by: string; approved_by: string | null } | undefined
  const publicLinks = () => pg.query(`select earlier_headline, later_headline, earlier_date::text as earlier_date, later_date::text as later_date, earlier_position, later_position from public.public_followups order by earlier_date`, 'anon') as { earlier_headline: string; later_headline: string; earlier_date: string; later_date: string }[]

  beforeEach(() => {
    pg.exec('truncate public.story_followups, public.stories, public.editions restart identity cascade')
    edition('old', day(-5), 'published')
    edition('mid', day(-3), 'published', true)
    edition('draft', day(-1), 'draft')
    edition('future', day(1), 'published') // approved ahead of time: not public until its day
  })

  it('an editor creates a link; it starts pending and is not public until an editor approves it', () => {
    link('old', 'mid')
    expect(row('old', 'mid')).toMatchObject({ status: 'pending', created_by: EDITOR, approved_by: null })
    expect(publicLinks()).toEqual([])
    approve('old', 'mid')
    expect(row('old', 'mid')).toMatchObject({ status: 'approved', approved_by: EDITOR })
    expect(publicLinks()).toEqual([expect.objectContaining({ earlier_headline: 'Story old', later_headline: 'Story mid', earlier_date: day(-5), later_date: day(-3) })])
  })

  it('cannot be created approved: a new link is forced to pending', () => {
    as(EDITOR, `insert into public.story_followups (earlier_story, later_story, explanation, source_url, status) values ('${ids.old}', '${ids.mid}', 'A real later development worth linking.', 'https://example.org/a', 'approved')`)
    expect(row('old', 'mid')?.status).toBe('pending')
  })

  it('refuses anyone who is not a signed-in editor: anonymous visitors, signed-in non-editors, and automated jobs', () => {
    expect(() => pg.exec(`insert into public.story_followups (earlier_story, later_story, explanation, source_url) values ('${ids.old}', '${ids.mid}', 'Anonymous attempt to link stories.', 'https://example.org/a')`, 'anon')).toThrow()
    expect(() => link('old', 'mid', READER)).toThrow()
    // The pipeline's service role skips row-level security, but the trigger still demands an editor.
    expect(() => pg.exec(`insert into public.story_followups (earlier_story, later_story, explanation, source_url) values ('${ids.old}', '${ids.mid}', 'An automated job tries to link stories.', 'https://example.org/a')`, 'service_role')).toThrow(/Only a signed-in editor/)
    expect(pg.query('select 1 from public.story_followups')).toHaveLength(0)
  })

  it('a non-editor cannot approve, change or remove a link, and cannot even see pending ones', () => {
    link('old', 'mid')
    as(READER, `update public.story_followups set status = 'approved'`) // RLS: matches no rows for a non-editor
    as(READER, `delete from public.story_followups`)
    expect(row('old', 'mid')?.status).toBe('pending')
    expect(() => pg.query(`select 1 from public.story_followups`, 'anon')).toThrow(/permission denied/)
  })

  it('refuses self-links, duplicates and links that run backwards in time', () => {
    expect(() => link('old', 'old')).toThrow()
    link('old', 'mid')
    expect(() => link('old', 'mid')).toThrow(/story_followups_once|duplicate/)
    expect(() => link('mid', 'old')).toThrow(/later edition/)
    // Same edition is not "later" either.
    expect(() => link('mid', 'mid-backup')).toThrow(/later edition/)
  })

  it('requires a real explanation and an https source', () => {
    expect(() => link('old', 'mid', EDITOR, 'too short')).toThrow()
    expect(() => link('old', 'mid', EDITOR, 'A perfectly good explanation of the link.', 'http://insecure.example/x')).toThrow()
    expect(() => link('old', 'mid', EDITOR, 'A perfectly good explanation of the link.', 'javascript:alert(1)')).toThrow()
  })

  it('changing what is linked or why withdraws the approval until it is approved again', () => {
    link('old', 'mid')
    approve('old', 'mid')
    as(EDITOR, `update public.story_followups set explanation = 'A different reason, written later by the editor.'`)
    expect(row('old', 'mid')).toMatchObject({ status: 'pending', approved_by: null })
    expect(publicLinks()).toEqual([])
  })

  it('shows nothing that leads to a draft, a future edition, a backup story or an unpublished edition', () => {
    for (const [a, b] of [['old', 'draft'], ['old', 'future'], ['old', 'mid-backup'], ['mid', 'draft']] as const) {
      link(a, b)
      approve(a, b)
    }
    expect(publicLinks()).toEqual([])
    link('old', 'mid')
    approve('old', 'mid')
    expect(publicLinks()).toHaveLength(1)
    // Unpublishing either edition hides the link at once; republishing brings it back.
    pg.exec(`update public.editions set status = 'review', published_at = null where edition_date = '${day(-3)}'`)
    expect(publicLinks()).toEqual([])
    pg.exec(`update public.editions set status = 'published', published_at = now() where edition_date = '${day(-3)}'`)
    expect(publicLinks()).toHaveLength(1)
  })

  it('an editor can remove a link, which disappears for readers', () => {
    link('old', 'mid')
    approve('old', 'mid')
    as(EDITOR, `delete from public.story_followups where earlier_story = '${ids.old}'`)
    expect(row('old', 'mid')).toBeUndefined()
    expect(publicLinks()).toEqual([])
  })

  it('linking and approving never touch the published stories themselves; deleting a draft story removes its links', () => {
    const before = pg.query(`select id, headline, summary, updated_at::text as u from public.stories order by id`)
    link('old', 'mid')
    approve('old', 'mid')
    link('old', 'draft')
    expect(pg.query(`select id, headline, summary, updated_at::text as u from public.stories order by id`)).toEqual(before)
    pg.exec(`delete from public.stories where id = '${ids.draft}'`)
    expect(row('old', 'draft')).toBeUndefined()
    expect(row('old', 'mid')).toBeDefined()
  })

  it('anonymous readers can read the public view but not the table', () => {
    link('old', 'mid')
    approve('old', 'mid')
    expect(() => pg.query('select * from public.story_followups', 'anon')).toThrow(/permission denied/)
    expect(pg.query('select explanation, source_url from public.public_followups', 'anon')).toEqual([{ explanation: 'The sanctuary was formally extended a year later.', source_url: 'https://www.bbc.co.uk/news/follow-up' }])
  })
})
