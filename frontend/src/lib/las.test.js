// @vitest-environment node
// (laz-rs loads its WASM through Node's fetch/Response; happy-dom's would be rejected)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadLasPointCloud, peekLasHeader } from './las'
import { makeLasFile } from './testing/lasFixture'

// Real files written by laspy, see testing/fixtures/make_fixtures.py.
// Point i is at (1000 + i, 2000 + 2i, i / 10); RGB is 16-bit (i*600, 0, 65535 - i*600).
const fixture = (name) => new File([readFileSync(new URL(`./testing/fixtures/${name}`, import.meta.url))], name)
const FIXTURE_POINTS = 100

const POINTS = [
  [0, 0, 0],
  [10, 20, 5],
  [4, 8, 2],
]

describe('peekLasHeader', () => {
  it('reads version, format, count and bounds', async () => {
    const h = await peekLasHeader(makeLasFile(POINTS))
    expect(h).toMatchObject({
      versionMajor: 1,
      versionMinor: 2,
      pointsFormatId: 0,
      isCompressed: false,
      pointsCount: 3,
      hasColor: false,
      mins: [0, 0, 0],
      maxs: [10, 20, 5],
    })
  })

  it.each([2, 3])('reports colour for point format %i', async (pointFormat) => {
    const h = await peekLasHeader(makeLasFile(POINTS, { pointFormat }))
    expect(h.hasColor).toBe(true)
  })

  it('detects the LAZ compression bit and masks it off the format id', async () => {
    const h = await peekLasHeader(makeLasFile(POINTS, { pointFormat: 0x80 | 3 }))
    expect(h.isCompressed).toBe(true)
    expect(h.pointsFormatId).toBe(3)
  })

  it('rejects files without the LASF signature', async () => {
    await expect(peekLasHeader(makeLasFile(POINTS, { magic: 'NOPE' }))).rejects.toThrow(/LASF/)
  })

  it('rejects LAS versions newer than 1.4', async () => {
    await expect(peekLasHeader(makeLasFile(POINTS, { versionMinor: 5 }))).rejects.toThrow(/LAS 1\.5/)
  })

  it('rejects unsupported point data formats', async () => {
    await expect(peekLasHeader(makeLasFile(POINTS, { pointFormat: 11 }))).rejects.toThrow(/format \(11\)/)
  })

  it.each([
    ['v14-fmt6.las', 6, false, false],
    ['v14-fmt6.laz', 6, true, false],
    ['v14-fmt7.laz', 7, true, true],
    ['v14-fmt8.laz', 8, true, true],
  ])('reads the LAS 1.4 header of %s', async (name, format, compressed, color) => {
    const h = await peekLasHeader(fixture(name))
    expect(h).toMatchObject({
      versionMajor: 1,
      versionMinor: 4,
      pointsFormatId: format,
      isCompressed: compressed,
      hasColor: color,
      // Formats 6-10 leave the legacy 32-bit count at 0; this must come from the 64-bit field.
      pointsCount: FIXTURE_POINTS,
    })
    expect(h.mins[0]).toBeCloseTo(1000)
    expect(h.maxs[1]).toBeCloseTo(2000 + 2 * (FIXTURE_POINTS - 1))
  })
})

describe.each(['v12-fmt3.laz', 'v14-fmt6.las', 'v14-fmt6.laz', 'v14-fmt7.laz', 'v14-fmt8.laz'])(
  'loadLasPointCloud(%s)',
  (name) => {
    it('decodes every point at the right position', async () => {
      const file = fixture(name)
      const cloud = await loadLasPointCloud(file, await peekLasHeader(file))
      expect(cloud.renderedCount).toBe(FIXTURE_POINTS)
      for (const i of [0, 1, 57, FIXTURE_POINTS - 1]) {
        expect(cloud.positions[i * 3]).toBeCloseTo(1000 + i, 2)
        expect(cloud.positions[i * 3 + 1]).toBeCloseTo(2000 + 2 * i, 2)
        expect(cloud.positions[i * 3 + 2]).toBeCloseTo(i / 10, 2)
      }
    })

    it('decimates to stay within maxPoints', async () => {
      const file = fixture(name)
      const cloud = await loadLasPointCloud(file, await peekLasHeader(file), { maxPoints: 30 })
      expect(cloud.skip).toBe(4)
      expect(cloud.renderedCount).toBe(25)
      expect(cloud.positions[3]).toBeCloseTo(1004, 2) // second kept point is #4
    })
  }
)

describe.each([
  ['v12-fmt2-black.laz', [0, 0, 0]],
  ['v14-fmt7-white.laz', [255, 255, 255]],
])('blank RGB in %s', (name, value) => {
  it('is dropped so the cloud is coloured by height', async () => {
    const file = fixture(name)
    const header = await peekLasHeader(file)
    expect(header.hasColor).toBe(true) // the format has RGB fields...
    const cloud = await loadLasPointCloud(file, header)
    expect(cloud.colors).toBeNull() // ...but they carry no colour
    expect(cloud.blankColor).toEqual(value)
  })
})

describe.each(['v12-fmt3.laz', 'v14-fmt7.laz', 'v14-fmt8.laz'])('colour in %s', (name) => {
  it('is kept and not reported as blank', async () => {
    const file = fixture(name)
    const cloud = await loadLasPointCloud(file, await peekLasHeader(file))
    expect(cloud.colors).not.toBeNull()
    expect(cloud.blankColor).toBeNull()
  })

  it('is decoded and scaled from 16 to 8 bits', async () => {
    const file = fixture(name)
    const { colors } = await loadLasPointCloud(file, await peekLasHeader(file))
    const i = 50
    expect(Array.from(colors.slice(i * 4, i * 4 + 4))).toEqual([
      Math.floor((i * 600) / 256),
      0,
      Math.floor((65535 - i * 600) / 256),
      255,
    ])
  })
})

describe('loadLasPointCloud', () => {
  it('parses all points when under the render cap', async () => {
    const file = makeLasFile(POINTS)
    const cloud = await loadLasPointCloud(file, await peekLasHeader(file))
    expect(cloud.skip).toBe(1)
    expect(cloud.renderedCount).toBe(3)
    expect(Array.from(cloud.positions)).toEqual(POINTS.flat())
    expect(cloud.colors).toBeNull()
  })

  it('decimates to stay within maxPoints', async () => {
    const points = Array.from({ length: 10 }, (_, i) => [i, i, i])
    const file = makeLasFile(points)
    const cloud = await loadLasPointCloud(file, await peekLasHeader(file), { maxPoints: 4 })
    expect(cloud.skip).toBe(3)
    expect(cloud.renderedCount).toBeLessThanOrEqual(4)
    expect(cloud.positions.length).toBe(cloud.renderedCount * 3)
  })
})
