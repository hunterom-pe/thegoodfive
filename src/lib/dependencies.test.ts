import { describe, expect, it } from 'vitest'
import lock from '../../package-lock.json?raw'

const atLeast = (version: string, min: string) => {
  const [a, b] = [version, min].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

describe('security-patched dependencies', () => {
  const packages = (JSON.parse(lock) as { packages: Record<string, { version: string }> }).packages
  it('react-router and react-router-dom are at 7.18.0 or later (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg)', () => {
    for (const name of ['react-router', 'react-router-dom']) {
      const version = packages[`node_modules/${name}`]?.version
      expect(version, name).toBeTruthy()
      expect(atLeast(version, '7.18.0'), `${name} ${version}`).toBe(true)
    }
  })
  it('only one copy of react-router is installed, so a vulnerable nested copy cannot hide', () => {
    const copies = Object.keys(packages).filter((k) => /(^|\/)node_modules\/react-router$/.test(k))
    expect(copies).toEqual(['node_modules/react-router'])
  })
})
