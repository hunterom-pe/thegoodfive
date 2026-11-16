/**
 * Share cards and edition keepsakes, drawn in the reader's own browser on a <canvas>: no server, no paid
 * service, no publisher photographs (only The Good Five's typography and squares). The layout rules are
 * pure functions so they can be tested without a browser; drawing takes a 2D context.
 */
import { CATEGORIES } from './categories'
import type { Category } from './types'

// ── Brand ─────────────────────────────────────────────────────────────
export const COLORS = { chalk: '#fafaf7', forest: '#304d3c', forestDeep: '#223a2c', sage: '#a5b49a', sageLight: '#c3cfb9', earth: '#80634d', blush: '#ebc9cc', ink: '#1e2a23', mist: '#eef0e9', line: '#d8dccf' }
const DISPLAY = '"Fraunces Variable", "Iowan Old Style", Georgia, serif'
const SANS = '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif'
/** The five-square motif, in order. */
export const FIVE = [COLORS.forest, COLORS.sage, COLORS.earth, COLORS.blush, COLORS.forest]
const CATEGORY_COLOR: Record<Category, string> = { nature: COLORS.sage, science: COLORS.forest, health: COLORS.blush, humanity: COLORS.earth, progress: COLORS.forestDeep }

export type CardFormat = 'square' | 'portrait'
export const SIZES: Record<CardFormat | 'keepsake', { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  keepsake: { width: 1080, height: 1350 },
}

// ── Text layout ───────────────────────────────────────────────────────
/** Width of `text` at `size` px. In the browser this is ctx.measureText; tests pass an approximation. */
export type Measure = (text: string, size: number) => number

/** Grapheme-safe characters (emoji and accented letters stay whole). */
type Segmenter = { segment(t: string): Iterable<{ segment: string }> }
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter }).Segmenter
/** Built once: it is used inside the wrapping loops, which run for every candidate font size. */
const graphemes: Segmenter | null = SegmenterCtor ? new SegmenterCtor(undefined, { granularity: 'grapheme' }) : null
const chars = (t: string): string[] => (graphemes ? [...graphemes.segment(t)].map((s) => s.segment) : Array.from(t))

/** Greedy word wrap. A single word wider than the line is broken between characters, so nothing runs off the card. */
export function wrapText(text: string, maxWidth: number, size: number, measure: Measure): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  const push = (w: string) => {
    if (measure(w, size) <= maxWidth) return w
    // Break an over-long word into pieces that fit.
    let piece = ''
    for (const c of chars(w)) {
      if (piece && measure(piece + c, size) > maxWidth) {
        lines.push(piece)
        piece = c
      } else piece += c
    }
    return piece
  }
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w
    if (measure(candidate, size) <= maxWidth) line = candidate
    else {
      if (line) lines.push(line)
      line = push(w)
    }
  }
  if (line) lines.push(line)
  return lines
}

export interface Fitted {
  size: number
  lines: string[]
  lineHeight: number
  /** True only if even the smallest allowed size could not hold the text and the last line was shortened. */
  truncated: boolean
}

/**
 * The largest size, from `maxSize` down to `minSize`, at which the text fits the box. The minimum keeps it readable
 * on a phone; only text that cannot fit even then is shortened, with an ellipsis, so it is never cut off mid-glyph.
 */
export function fitText(text: string, box: { width: number; height: number }, opts: { maxSize: number; minSize: number; leading: number }, measure: Measure): Fitted {
  for (let size = opts.maxSize; size >= opts.minSize; size -= 2) {
    const lines = wrapText(text, box.width, size, measure)
    const lineHeight = Math.round(size * opts.leading)
    if (lines.length * lineHeight <= box.height) return { size, lines, lineHeight, truncated: false }
  }
  const size = opts.minSize
  const lineHeight = Math.round(size * opts.leading)
  const max = Math.max(1, Math.floor(box.height / lineHeight))
  const lines = wrapText(text, box.width, size, measure).slice(0, max)
  let last = lines[max - 1] ?? ''
  while (last && measure(`${last}…`, size) > box.width) last = chars(last).slice(0, -1).join('')
  lines[max - 1] = `${last.replace(/[\s,;:.-]+$/, '')}…`
  return { size, lines, lineHeight, truncated: true }
}

// ── Edition covers ────────────────────────────────────────────────────
/** FNV-1a: the same text always gives the same number, on every device. */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (const c of text) {
    h ^= c.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
/** A small, fast seeded random number generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface CoverSquare {
  /** Position and size in a 100 × 100 box. */
  x: number
  y: number
  size: number
  color: string
  /** Which story (1-5) it stands for. */
  story: number
}

/**
 * Each edition's cover: five squares, one per story, coloured by its category, sized and placed by a generator
 * seeded with the edition's date. Deterministic, so the same edition looks the same on every visit and device;
 * squares never leave the box and never overlap.
 */
export function coverLayout(date: string, categories: Category[]): CoverSquare[] {
  const rand = seeded(hashString(`good-five:${date}`))
  const base = [34, 26, 20, 16, 12].map((s) => s + Math.round(rand() * 8) - 4) // lead story largest
  const colorOf = (i: number) => CATEGORY_COLOR[categories[i] ?? 'nature'] ?? COLORS.sage
  const overlaps = (a: CoverSquare, b: CoverSquare, gap = 3) => a.x < b.x + b.size + gap && b.x < a.x + a.size + gap && a.y < b.y + b.size + gap && b.y < a.y + a.size + gap
  // Try the full sizes first; if a crowded draw can't place all five, try again a little smaller. All of it is
  // driven by the same seed, so the result is still the same on every device.
  for (const scale of [1, 0.9, 0.8, 0.7, 0.6]) {
    const placed: CoverSquare[] = []
    for (let i = 0; i < 5; i++) {
      const size = Math.max(8, Math.round(base[i] * scale))
      let square: CoverSquare | null = null
      for (let attempt = 0; attempt < 120 && !square; attempt++) {
        const s = { x: 4 + Math.round(rand() * (92 - size)), y: 4 + Math.round(rand() * (92 - size)), size, color: colorOf(i), story: i + 1 }
        if (!placed.some((p) => overlaps(p, s))) square = s
      }
      if (!square) break
      placed.push(square)
    }
    if (placed.length === 5) return placed
  }
  // A fixed arrangement that cannot overlap, should every draw fail (none did across years of dates in testing).
  const fixed = [
    [4, 4, 34],
    [46, 10, 26],
    [10, 46, 20],
    [50, 50, 16],
    [76, 76, 12],
  ]
  return fixed.map(([x, y, size], i) => ({ x, y, size, color: colorOf(i), story: i + 1 }))
}

// ── Drawing ───────────────────────────────────────────────────────────
export interface StoryCardData {
  headline: string
  position: number
  category: Category
  sourceName: string
  /** e.g. "Saturday 14 November 2026" */
  dateLabel: string
  /** e.g. "thegoodfive.netlify.app/edition/2026-11-14#story-2" */
  linkLabel: string
}

const measurer = (ctx: CanvasRenderingContext2D, family: string, weight: number): Measure => (text, size) => {
  ctx.font = `${weight} ${size}px ${family}`
  return ctx.measureText(text).width
}

function fiveSquares(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, gap: number, colors = FIVE) {
  colors.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(x + i * (size + gap), y, size, size)
  })
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, spacing = 0.14) {
  ctx.font = `600 ${size}px ${SANS}`
  ctx.fillStyle = color
  ;(ctx as unknown as { letterSpacing?: string }).letterSpacing = `${(size * spacing).toFixed(1)}px`
  ctx.fillText(text.toUpperCase(), x, y)
  ;(ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px'
}

/** A story card: brand, date, story number and category, the headline, the source and the link. */
export function drawStoryCard(ctx: CanvasRenderingContext2D, card: StoryCardData, format: CardFormat): Fitted {
  const { width: W, height: H } = SIZES[format]
  const pad = 80
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COLORS.chalk
  ctx.fillRect(0, 0, W, H)

  // Masthead
  fiveSquares(ctx, pad, pad, 26, 12)
  ctx.font = `480 46px ${DISPLAY}`
  ctx.fillStyle = COLORS.forest
  ctx.fillText('The Good Five', pad, pad + 26 + 66)
  label(ctx, card.dateLabel, pad, pad + 26 + 66 + 52, 24, COLORS.earth)
  ctx.fillStyle = COLORS.line
  ctx.fillRect(pad, pad + 190, W - 2 * pad, 2)

  // Story label and headline
  const top = pad + 270
  if (format === 'portrait') {
    // The tall card has room for the edition's own colours: a band of the five squares under the masthead.
    fiveSquares(ctx, W - pad - 5 * 26 - 4 * 12, pad, 26, 12, [COLORS.sageLight, COLORS.blush, COLORS.sage, COLORS.earth, COLORS.forest])
  }
  label(ctx, `${String(card.position).padStart(2, '0')} / 05 · ${CATEGORIES[card.category]?.label ?? ''}`, pad, top, 26, COLORS.forest)
  const footer = format === 'square' ? 190 : 260
  const box = { width: W - 2 * pad, height: H - (top + 50) - footer - pad }
  const fitted = fitText(card.headline, box, { maxSize: format === 'square' ? 88 : 104, minSize: format === 'square' ? 46 : 52, leading: 1.08 }, measurer(ctx, DISPLAY, 420))
  ctx.font = `420 ${fitted.size}px ${DISPLAY}`
  ctx.fillStyle = COLORS.forest
  // On the tall format, the headline sits a little above the middle of its space instead of hanging from the top.
  const spare = box.height - fitted.lines.length * fitted.lineHeight
  const offset = format === 'portrait' ? Math.max(0, Math.round(spare * 0.38)) : 0
  fitted.lines.forEach((line, i) => ctx.fillText(line, pad, top + 50 + offset + fitted.size + i * fitted.lineHeight))

  // Brand squares bottom right, out of the text's way
  const s = format === 'square' ? 120 : 170
  ctx.fillStyle = COLORS.sage
  ctx.fillRect(W - pad - s, H - pad - s - 40, s, s)
  ctx.fillStyle = COLORS.blush
  ctx.fillRect(W - pad - s - s * 0.3, H - pad - s * 0.45 - 40, s * 0.32, s * 0.32)

  // Source and link
  const textWidth = W - 2 * pad - s - 60
  ctx.font = `500 30px ${SANS}`
  ctx.fillStyle = COLORS.ink
  const source = fitText(`Reported by ${card.sourceName}`, { width: textWidth, height: 40 }, { maxSize: 30, minSize: 22, leading: 1.2 }, measurer(ctx, SANS, 500))
  ctx.font = `500 ${source.size}px ${SANS}`
  ctx.fillText(source.lines[0], pad, H - pad - 70)
  const link = fitText(card.linkLabel, { width: textWidth, height: 34 }, { maxSize: 24, minSize: 18, leading: 1.2 }, measurer(ctx, SANS, 600))
  ctx.font = `600 ${link.size}px ${SANS}`
  ctx.fillStyle = COLORS.forest
  ctx.fillText(link.lines[0], pad, H - pad - 26)
  return fitted
}

export interface KeepsakeData {
  dateLabel: string
  date: string
  stories: { position: number; headline: string; category: Category }[]
  linkLabel: string
}

/** An edition keepsake: its cover composition, its date, and its five headlines. */
export function drawKeepsake(ctx: CanvasRenderingContext2D, k: KeepsakeData): void {
  const { width: W, height: H } = SIZES.keepsake
  const pad = 80
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COLORS.forest
  ctx.fillRect(0, 0, W, H)

  // Cover composition, top right
  const box = 420
  const bx = W - pad - box
  const by = pad
  ctx.strokeStyle = 'rgba(250,250,247,0.25)'
  ctx.lineWidth = 2
  ctx.strokeRect(bx, by, box, box)
  for (const sq of coverLayout(k.date, k.stories.map((s) => s.category))) {
    ctx.fillStyle = sq.color === COLORS.forest || sq.color === COLORS.forestDeep ? COLORS.sageLight : sq.color
    ctx.fillRect(bx + (sq.x / 100) * box, by + (sq.y / 100) * box, (sq.size / 100) * box, (sq.size / 100) * box)
  }

  // Masthead and date
  fiveSquares(ctx, pad, pad, 22, 10, [COLORS.chalk, COLORS.sageLight, COLORS.blush, COLORS.sage, COLORS.chalk])
  ctx.font = `480 44px ${DISPLAY}`
  ctx.fillStyle = COLORS.chalk
  ctx.fillText('The Good Five', pad, pad + 22 + 60)
  const dateFit = fitText(k.dateLabel, { width: bx - pad - 40, height: 260 }, { maxSize: 76, minSize: 44, leading: 1.02 }, measurer(ctx, DISPLAY, 420))
  ctx.font = `420 ${dateFit.size}px ${DISPLAY}`
  ctx.fillStyle = COLORS.chalk
  dateFit.lines.forEach((line, i) => ctx.fillText(line, pad, pad + 200 + dateFit.size + i * dateFit.lineHeight))

  // The five headlines
  let y = by + box + 90
  const listBottom = H - pad - 70
  const perStory = (listBottom - y) / Math.max(1, k.stories.length)
  for (const s of k.stories) {
    label(ctx, String(s.position).padStart(2, '0'), pad, y + 6, 22, COLORS.sageLight)
    const fit = fitText(s.headline, { width: W - 2 * pad - 70, height: perStory - 18 }, { maxSize: 34, minSize: 24, leading: 1.18 }, measurer(ctx, SANS, 500))
    ctx.font = `500 ${fit.size}px ${SANS}`
    ctx.fillStyle = COLORS.chalk
    fit.lines.forEach((line, i) => ctx.fillText(line, pad + 70, y + 8 + i * fit.lineHeight))
    y += perStory
  }
  ctx.fillStyle = 'rgba(250,250,247,0.3)'
  ctx.fillRect(pad, H - pad - 44, W - 2 * pad, 1)
  label(ctx, k.linkLabel, pad, H - pad, 20, COLORS.sageLight, 0.06)
}

// ── Export and share ──────────────────────────────────────────────────
/** The canvas as a PNG. Rejects with a plain message if the browser cannot produce one. */
export function canvasToPng(canvas: Pick<HTMLCanvasElement, 'toBlob'>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob && blob.size > 0 ? resolve(blob) : reject(new Error('This browser could not create the image.'))), 'image/png')
    } catch {
      reject(new Error('This browser could not create the image.'))
    }
  })
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed'

/** Share an image file through the device's share sheet, where the browser supports sharing files. */
export async function shareImageFile(blob: Blob, filename: string, data: { title: string; url: string }, nav: Partial<Navigator> = typeof navigator !== 'undefined' ? navigator : {}): Promise<ShareOutcome> {
  if (typeof File === 'undefined' || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'unsupported'
  const file = new File([blob], filename, { type: 'image/png' })
  if (!nav.canShare({ files: [file] })) return 'unsupported'
  try {
    await nav.share({ files: [file], title: data.title, url: data.url })
    return 'shared'
  } catch (e) {
    return e instanceof Error && e.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

/** A safe file name: the site, the date and a short slug, ASCII only. */
export function imageFilename(kind: 'story' | 'edition', date: string, extra = ''): string {
  const slug = extra.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return ['the-good-five', date, kind === 'edition' ? 'edition' : slug || 'story'].join('-') + '.png'
}
