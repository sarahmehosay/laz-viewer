// Builds minimal uncompressed LAS 1.2 files in memory for tests.

const HEADER_SIZE = 227
const RECORD_LENGTH = 20 // point data format 0
const SCALE = 0.01

/**
 * points: array of [x, y, z] in metres. Header fields can be overridden to
 * produce invalid or unsupported files.
 */
export function makeLasFile(points = [], overrides = {}) {
  const {
    magic = 'LASF',
    versionMajor = 1,
    versionMinor = 2,
    pointFormat = 0,
    pointsCount = points.length,
    name = 'test.las',
  } = overrides

  const buf = new ArrayBuffer(HEADER_SIZE + points.length * RECORD_LENGTH)
  const dv = new DataView(buf)
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i) || 0)
  dv.setUint8(24, versionMajor)
  dv.setUint8(25, versionMinor)
  dv.setUint16(94, HEADER_SIZE, true)
  dv.setUint32(96, HEADER_SIZE, true) // offset to point data
  dv.setUint32(100, 0, true) // no VLRs
  dv.setUint8(104, pointFormat)
  dv.setUint16(105, RECORD_LENGTH, true)
  dv.setUint32(107, pointsCount, true)
  dv.setUint32(111, points.length, true) // all first returns
  for (let a = 0; a < 3; a++) {
    dv.setFloat64(131 + a * 8, SCALE, true)
    dv.setFloat64(155 + a * 8, 0, true)
  }

  const axis = (a) => points.map((p) => p[a])
  const [xs, ys, zs] = [axis(0), axis(1), axis(2)]
  const bound = (vals, fn) => (vals.length ? fn(...vals) : 0)
  ;[
    [179, bound(xs, Math.max)], [187, bound(xs, Math.min)],
    [195, bound(ys, Math.max)], [203, bound(ys, Math.min)],
    [211, bound(zs, Math.max)], [219, bound(zs, Math.min)],
  ].forEach(([o, v]) => dv.setFloat64(o, v, true))

  points.forEach(([x, y, z], i) => {
    const o = HEADER_SIZE + i * RECORD_LENGTH
    dv.setInt32(o, Math.round(x / SCALE), true)
    dv.setInt32(o + 4, Math.round(y / SCALE), true)
    dv.setInt32(o + 8, Math.round(z / SCALE), true)
    dv.setUint8(o + 14, 0b00001001) // return 1 of 1
  })

  return new File([buf], name)
}
