/**
 * A throwaway Postgres plus a small Supabase-compatible client over it, so the REAL server code
 * (store.ts, autopublish.ts, the pipeline) can run end to end without touching the live project.
 * Only the query shapes our server code uses are implemented. Test tooling: not part of the site.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.E2E_PG_PORT ?? 54330) // override to run two suites side by side

export interface PgInstance {
  dir: string
  /** Run SQL as a database role and return the rows as objects. */
  query(sql: string, role?: string): unknown[]
  exec(sql: string, role?: string): void
  stop(): void
}

const bin = (name: string) => {
  const r = spawnSync('which', [name], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}
export const postgresAvailable = () => Boolean(bin('initdb') && bin('pg_ctl') && bin('psql'))

export function startPg(): PgInstance {
  const dir = mkdtempSync(join(tmpdir(), 'goodfive-e2e-'))
  const env = { ...process.env, LC_ALL: 'en_US.UTF-8' }
  execFileSync('initdb', ['-D', join(dir, 'data'), '-U', 'postgres'], { env, stdio: 'ignore' })
  execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { env, stdio: 'ignore' })
  const run = (sql: string) => {
    const r = spawnSync('psql', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-f', '-'], { input: sql, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) throw new Error((r.stderr || '').replace(/^psql:.*?ERROR:\s*/s, '').split('\n')[0] || 'SQL failed')
    return r.stdout
  }
  const pg: PgInstance = {
    dir,
    exec: (sql, role = 'postgres') => void run(`set role ${role};\n${sql}`),
    query(sql, role = 'postgres') {
      // json_agg spreads many rows over several lines: parse the whole output, not the last line.
      // Inserts/updates with RETURNING cannot sit in a subquery: wrap them in a CTE instead.
      const wrapped = /^\s*(insert|update|delete)\b/i.test(sql) ? `with t as (${sql}) select coalesce(json_agg(t), '[]'::json) from t;` : `select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`
      const out = run(`set role ${role};\n${wrapped}`).trim()
      return JSON.parse(out || '[]') as unknown[]
    },
    stop: () => {
      try {
        execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'], { env, stdio: 'ignore' })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
  try {
    run(readFileSync(join(ROOT, 'supabase/tests/local_shim.sql'), 'utf8'))
    for (const f of readdirSync(join(ROOT, 'supabase/migrations')).sort()) run(readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'))
  } catch (e) {
    pg.stop() // never leave a stray database running if setup fails
    throw e
  }
  return pg
}

// ── SQL literals ─────────────────────────────────────────────────────────
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`

// Argument types for the database functions we call through rpc().
const ARG_TYPES: Record<string, string> = { p_stories: 'jsonb', p_rejections: 'jsonb', p_image: 'jsonb', p_primary: 'uuid[]', p_date: 'date', p_edition: 'uuid', p_story: 'uuid', p_status: 'public.edition_status', p_primary_ids: 'uuid[]', p_checked: 'jsonb' }

interface Filter { col: string; op: string; val: unknown }
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

// stories -> editions is many-to-one; editions -> stories is one-to-many.
const FK = { stories: { editions: ['edition_id', 'id'] }, editions: { stories: ['id', 'edition_id'] } } as Record<string, Record<string, [string, string]>>

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private cols = '*'
  private filters: Filter[] = []
  private orders: string[] = []
  private max: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private head = false
  private count = false
  private body: Record<string, unknown> | Record<string, unknown>[] | null = null
  private returning = false
  constructor(private pg: PgInstance, private role: string, private table: string, private hook?: (kind: string, table: string) => { message: string } | void) {}

  select(cols = '*', opts?: { count?: 'exact'; head?: boolean }) {
    if (this.op === 'select') this.cols = cols
    else { this.returning = true; this.cols = cols }
    this.head = Boolean(opts?.head)
    this.count = Boolean(opts?.count)
    return this
  }
  insert(body: Query['body']) { this.op = 'insert'; this.body = body; return this }
  update(body: Record<string, unknown>) { this.op = 'update'; this.body = body; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push({ col, op: '=', val }); return this }
  neq(col: string, val: unknown) { this.filters.push({ col, op: '<>', val }); return this }
  gte(col: string, val: unknown) { this.filters.push({ col, op: '>=', val }); return this }
  lt(col: string, val: unknown) { this.filters.push({ col, op: '<', val }); return this }
  lte(col: string, val: unknown) { this.filters.push({ col, op: '<=', val }); return this }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push(`${col} ${o?.ascending === false ? 'desc' : 'asc'}`); return this }
  limit(n: number) { this.max = n; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }

  /** Split "a, b, rel(x, y), rel2!inner(z)" at top-level commas. */
  private parts(cols: string) {
    const out: string[] = []
    let depth = 0, cur = ''
    for (const ch of cols) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }

  private build(): { sql: string; wantsRows: boolean } {
    const where = (aliasOf: (c: string) => string) => (this.filters.length ? ' where ' + this.filters.map((f) => `${aliasOf(f.col)} ${f.op} ${lit(f.val)}`).join(' and ') : '')
    if (this.op === 'insert') {
      const rows = Array.isArray(this.body) ? this.body : [this.body!]
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
      const values = rows.map((r) => `(${keys.map((k) => lit(r[k])).join(', ')})`).join(', ')
      return { sql: `insert into public.${ident(this.table)} (${keys.map(ident).join(', ')}) values ${values}${this.returning ? ` returning ${this.cols === '*' ? '*' : this.cols}` : ''}`, wantsRows: this.returning }
    }
    if (this.op === 'update') {
      const sets = Object.entries(this.body!).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(', ')
      return { sql: `update public.${ident(this.table)} set ${sets}${where((c) => ident(c))}${this.returning ? ` returning ${this.cols}` : ''}`, wantsRows: this.returning }
    }
    if (this.op === 'delete') return { sql: `delete from public.${ident(this.table)}${where((c) => ident(c))}`, wantsRows: false }

    // select, with embedded relations
    const select: string[] = []
    const joins: string[] = []
    const embedAlias: Record<string, string> = {}
    for (const p of this.parts(this.cols)) {
      const m = /^(\w+)(!inner)?\((.*)\)$/.exec(p)
      if (!m) { select.push(p === '*' ? 't.*' : `t.${ident(p)}`); continue }
      const [, rel, inner, inside] = m
      const fk = FK[this.table]?.[rel]
      if (!fk) throw new Error(`unsupported embed ${this.table} -> ${rel}`)
      const relCols = this.parts(inside).map((c) => ident(c))
      if (this.table === 'stories') {
        embedAlias[rel] = rel
        joins.push(`${inner ? 'join' : 'left join'} public.${rel} ${rel} on ${rel}.${fk[1]} = t.${fk[0]}`)
        select.push(`json_build_object(${this.parts(inside).map((c) => `'${c}', ${rel}.${ident(c)}`).join(', ')}) as ${rel}`)
      } else {
        select.push(`coalesce((select json_agg(x) from (select ${relCols.join(', ')} from public.${rel} r where r.${fk[1]} = t.${fk[0]}) x), '[]'::json) as ${rel}`)
      }
    }
    const aliasOf = (c: string) => (c.includes('.') ? `${embedAlias[c.split('.')[0]]}.${ident(c.split('.')[1])}` : `t.${ident(c)}`)
    const order = this.orders.length ? ` order by ${this.orders.map((o) => `t.${o.split(' ')[0]} ${o.split(' ')[1]}`).join(', ')}` : ''
    const limit = this.max !== null ? ` limit ${this.max}` : ''
    return { sql: `select ${this.count && this.head ? 'count(*)::int as count' : select.join(', ')} from public.${ident(this.table)} t ${joins.join(' ')}${where(aliasOf)}${order}${limit}`, wantsRows: true }
  }

  then<R1 = Result, R2 = never>(ok?: ((v: Result) => R1 | PromiseLike<R1>) | null, bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2> {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }

  private run(): Result {
    // A simulated outage answers the way supabase-js does: with an error value, not an exception.
    const outage = this.hook?.(this.op, this.table)
    if (outage) return { data: null, error: { message: outage.message } }
    try {
      const { sql, wantsRows } = this.build()
      if (!wantsRows) { this.pg.exec(sql, this.role); return { data: null, error: null } }
      const rows = this.pg.query(sql, this.role) as Record<string, unknown>[]
      if (this.count && this.head) return { data: null, error: null, count: (rows[0]?.count as number) ?? 0 }
      if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `Expected one row, got ${rows.length}`, code: 'PGRST116' } }
      if (this.mode === 'maybe') return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: 'More than one row', code: 'PGRST116' } }
      return { data: rows, error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { data: null, error: { message, code: /duplicate key/.test(message) ? '23505' : undefined } }
    }
  }
}

export interface LocalDbOptions {
  role?: string
  /** Called before every database operation: lets a test simulate an outage by throwing or returning an error. */
  onCall?: (kind: string, name: string) => { message: string } | void
}

/** A client shaped like supabase-js for the calls our server makes. Cast it where a SupabaseClient is expected. */
export function localDb(pg: PgInstance, options: LocalDbOptions = {}): SupabaseClient {
  const role = options.role ?? 'service_role'
  const fail = (kind: string, name: string) => options.onCall?.(kind, name)
  const client = {
    from: (table: string) => {
      const q = new Query(pg, role, table, (kind, t) => fail(kind, t))
      return q
    },
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      const f = fail('rpc', fn)
      if (f) return { data: null, error: { message: f.message } }
      try {
        const named = Object.entries(args).map(([k, v]) => `${k} := ${Array.isArray(v) && ARG_TYPES[k] === 'uuid[]' ? `'{${v.map((x) => `"${x}"`).join(',')}}'` : lit(v)}${ARG_TYPES[k] ? `::${ARG_TYPES[k]}` : ''}`).join(', ')
        const rows = pg.query(`select to_json(public.${fn}(${named})) as r`, role) as { r: unknown }[]
        return { data: rows[0]?.r ?? null, error: null }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
      }
    },
  }
  return client as unknown as SupabaseClient
}
