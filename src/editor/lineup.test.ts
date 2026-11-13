import { describe, expect, it } from 'vitest'
import { move, promote, reject, restore, swapWithBackup, type Lineup } from './lineup'

const base: Lineup = { primary: ['a', 'b', 'c', 'd', 'e'], backup: ['x', 'y', 'z'] }

describe('lineup', () => {
  it('reorders within the five and ignores moves off either end', () => {
    expect(move(base, 'b', -1).primary).toEqual(['b', 'a', 'c', 'd', 'e'])
    expect(move(base, 'a', -1)).toBe(base)
    expect(move(base, 'e', 1)).toBe(base)
  })
  it('swaps a story with a backup in place', () => {
    expect(swapWithBackup(base, 'c', 'y')).toEqual({ primary: ['a', 'b', 'y', 'd', 'e'], backup: ['x', 'c', 'z'] })
  })
  it('fills a rejected slot from the first backup', () => {
    expect(reject(base, 'b')).toEqual({ primary: ['a', 'x', 'c', 'd', 'e'], backup: ['y', 'z'] })
  })
  it('leaves a gap when there is no backup left', () => {
    expect(reject({ primary: ['a', 'b'], backup: [] }, 'a')).toEqual({ primary: ['b'], backup: [] })
  })
  it('rejects a backup without touching the five', () => {
    expect(reject(base, 'y')).toEqual({ primary: base.primary, backup: ['x', 'z'] })
  })
  it('restores to the bench and promotes only into an empty slot', () => {
    const short: Lineup = { primary: ['a', 'b', 'c', 'd'], backup: ['x'] }
    expect(restore(short, 'q').backup).toEqual(['x', 'q'])
    expect(promote(short, 'x')).toEqual({ primary: ['a', 'b', 'c', 'd', 'x'], backup: [] })
    expect(promote(base, 'x')).toBe(base)
  })
})
