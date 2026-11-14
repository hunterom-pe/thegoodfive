import { describe, expect, it } from 'vitest'

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const mix = (fg: string, bg: string, alpha: number) => '#' + hex(fg).map((v, i) => Math.round(v * alpha + hex(bg)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')

// Keep in step with @theme in src/index.css.
const T = { chalk: '#FAFAF7', mist: '#EEF0E9', forest: '#304D3C', earth: '#80634D', sage: '#A5B49A', sageDeep: '#5F6F55', sageLight: '#C3CFB9', blush: '#EBC9CC', ink: '#1E2A23' }

describe('text contrast (WCAG AA, 4.5:1)', () => {
  it.each([
    ['forest on chalk', T.forest, T.chalk],
    ['earth on chalk', T.earth, T.chalk],
    ['earth on mist', T.earth, T.mist],
    ['sage-deep on chalk', T.sageDeep, T.chalk],
    ['sage-deep on mist', T.sageDeep, T.mist],
    ['sage-light on forest', T.sageLight, T.forest],
    ['blush on forest', T.blush, T.forest],
    ['chalk on forest', T.chalk, T.forest],
    ['ink/70 on chalk', mix(T.ink, T.chalk, 0.7), T.chalk],
    ['ink/70 on mist', mix(T.ink, T.mist, 0.7), T.mist],
    ['chalk/70 on forest', mix(T.chalk, T.forest, 0.7), T.forest],
  ])('%s', (_name, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('documents why the brand sage is not used for text', () => {
    expect(ratio(T.sage, T.chalk)).toBeLessThan(3)
  })
})
