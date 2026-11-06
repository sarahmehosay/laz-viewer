// laz-rs (WASM) rather than the default laz-perf build: it decodes LAS/LAZ 1.4
// and point data formats 4-10, which laz-perf's loader does not.
import { LAZRsLoader } from '@loaders.gl/las'
import { wktEpsg, wktVerticalUnitsToMetres } from './crs.js'

export const MAX_FILE_SIZE = 1.5 * 1024 ** 3 // 1.5 GiB, practical browser ArrayBuffer limit
export const MAX_RENDER_POINTS = 800_000 // interactive cap for PointPrimitiveCollection

const SUPPORTED_POINT_FORMATS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
const COLOR_POINT_FORMATS = new Set([2, 3, 5, 7, 8, 10])

/**
 * Reads just the fixed-size LAS/LAZ public header block (no point data) so we
 * can validate the file and size the decimation factor before doing a full parse.
 */
export async function peekLasHeader(file) {
  const head = await file.slice(0, 300).arrayBuffer()
  const dv = new DataView(head)

  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
  if (magic !== 'LASF') {
    throw new Error('Not a valid LAS/LAZ file (missing "LASF" file signature).')
  }

  const versionMajor = dv.getUint8(24)
  const versionMinor = dv.getUint8(25)
  const version = versionMajor * 10 + versionMinor
  if (version > 14) {
    throw new Error(
      `LAS ${versionMajor}.${versionMinor} is not supported (this viewer only supports LAS 1.0-1.4).`
    )
  }

  const pointsFormatIdRaw = dv.getUint8(104)
  const pointsFormatId = pointsFormatIdRaw & 0x3f
  const isCompressed = ((pointsFormatIdRaw & 0x80) >> 7) === 1 || ((pointsFormatIdRaw & 0x40) >> 6) === 1
  // LAS 1.4 moved the point count to a 64-bit field; the legacy 32-bit one is 0 for formats 6-10.
  const pointsCount = version === 14 ? Number(dv.getBigUint64(247, true)) : dv.getUint32(107, true)
  const bounds = [179, 187, 195, 203, 211, 219].map((o) => dv.getFloat64(o, true))

  if (!SUPPORTED_POINT_FORMATS.has(pointsFormatId)) {
    throw new Error(`Unsupported LAS point data format (${pointsFormatId}).`)
  }

  return {
    versionMajor,
    versionMinor,
    pointsFormatId,
    isCompressed,
    pointsCount,
    hasColor: COLOR_POINT_FORMATS.has(pointsFormatId),
    maxs: [bounds[0], bounds[2], bounds[4]],
    mins: [bounds[1], bounds[3], bounds[5]],
    headerSize: dv.getUint16(94, true),
    vlrCount: dv.getUint32(100, true),
    // Extended VLRs (after the point data) only exist in LAS 1.4
    evlrStart: version === 14 ? Number(dv.getBigUint64(235, true)) : 0,
    evlrCount: version === 14 ? dv.getUint32(243, true) : 0,
  }
}

// GeoTIFF keys used in the LASF_Projection GeoKeyDirectory VLR
const GEO_KEY = { modelType: 1024, geographicType: 2048, projectedType: 3072, projLinearUnits: 3076, verticalUnits: 4099 }
const USER_DEFINED = 32767
// EPSG linear unit codes -> metres
const LINEAR_UNITS = { 9001: 1, 9002: 0.3048, 9003: 1200 / 3937 }

/**
 * Reads the coordinate reference system from the file's (E)VLRs: an OGC WKT
 * record (LAS 1.4) or a GeoTIFF GeoKeyDirectory. Returns null if there is none.
 *   { epsg, wkt, zUnitsToMetres, source: 'wkt' | 'geotiff' }
 */
export async function readLasCrs(file, header) {
  const records = []
  const vlrBytes = await file.slice(header.headerSize, header.headerSize + 2 ** 20).arrayBuffer()
  records.push(...readVlrs(new DataView(vlrBytes), header.vlrCount, false))
  if (header.evlrCount > 0 && header.evlrStart > 0) {
    const evlrBytes = await file.slice(header.evlrStart, header.evlrStart + 2 ** 22).arrayBuffer()
    records.push(...readVlrs(new DataView(evlrBytes), header.evlrCount, true))
  }
  const proj = records.filter((r) => r.userId === 'LASF_Projection')

  const wktRecord = proj.find((r) => r.recordId === 2112)
  if (wktRecord) {
    const wkt = new TextDecoder().decode(wktRecord.data).replace(/\0+$/, '').trim()
    if (wkt) {
      return { epsg: wktEpsg(wkt), wkt, zUnitsToMetres: wktVerticalUnitsToMetres(wkt), source: 'wkt' }
    }
  }

  const geoKeys = proj.find((r) => r.recordId === 34735)
  if (geoKeys) {
    const keys = parseGeoKeys(geoKeys.data)
    const projected = keys.get(GEO_KEY.projectedType)
    const geographic = keys.get(GEO_KEY.geographicType)
    const modelType = keys.get(GEO_KEY.modelType)
    let epsg = null
    if (projected && projected !== USER_DEFINED) epsg = projected
    else if (modelType === 2 && geographic && geographic !== USER_DEFINED) epsg = geographic
    if (epsg) {
      // Heights use the vertical unit key, or the horizontal unit when that key is missing.
      const zUnit = keys.get(GEO_KEY.verticalUnits) ?? keys.get(GEO_KEY.projLinearUnits)
      return { epsg, wkt: null, zUnitsToMetres: LINEAR_UNITS[zUnit] ?? 1, source: 'geotiff' }
    }
  }
  return null
}

function readVlrs(dv, count, extended) {
  const headerLength = extended ? 60 : 54
  const out = []
  let o = 0
  for (let i = 0; i < count && o + headerLength <= dv.byteLength; i++) {
    const userId = ascii(dv, o + 2, 16)
    const recordId = dv.getUint16(o + 18, true)
    const length = extended ? Number(dv.getBigUint64(o + 20, true)) : dv.getUint16(o + 20, true)
    const start = o + headerLength
    if (start + length > dv.byteLength) break // record runs past what we read
    out.push({ userId, recordId, data: new Uint8Array(dv.buffer, dv.byteOffset + start, length) })
    o = start + length
  }
  return out
}

function ascii(dv, offset, length) {
  let s = ''
  for (let i = 0; i < length; i++) {
    const c = dv.getUint8(offset + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

/** GeoKeyDirectory: header (4 x u16) then 4 x u16 per key; only inline (short) values are kept. */
function parseGeoKeys(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const keys = new Map()
  const count = dv.getUint16(6, true)
  for (let i = 0; i < count && 8 + i * 8 + 8 <= dv.byteLength; i++) {
    const o = 8 + i * 8
    const id = dv.getUint16(o, true)
    const location = dv.getUint16(o + 2, true)
    if (location === 0) keys.set(id, dv.getUint16(o + 6, true))
  }
  return keys
}

/**
 * Parses the full point data, decimating on the fly so the rendered point
 * count stays within maxPoints regardless of the source file's size.
 */
export async function loadLasPointCloud(file, header, { maxPoints = MAX_RENDER_POINTS } = {}) {
  const skip = Math.max(1, Math.ceil(header.pointsCount / maxPoints))
  const arrayBuffer = await file.arrayBuffer()
  const mesh = await LAZRsLoader.parse(arrayBuffer, {
    // fp64: georeferenced coordinates (e.g. UTM northings in the millions) lose
    // decimetres to float32 rounding.
    las: { skip, colorDepth: 'auto', fp64: true },
  })

  const renderedCount = mesh.header.vertexCount
  let colors = mesh.attributes.COLOR_0 ? mesh.attributes.COLOR_0.value : null
  // Some scanners write the RGB fields without capturing colour (every point
  // 0,0,0 or 255,255,255). That carries no information, so colour by height instead.
  const blankColor = colors && uniformColor(colors, renderedCount)
  if (blankColor) colors = null

  return {
    positions: mesh.attributes.POSITION.value,
    colors,
    blankColor,
    boundingBox: mesh.header.boundingBox,
    renderedCount,
    skip,
  }
}

/** Returns [r, g, b] if every point has that same colour, otherwise null. */
function uniformColor(colors, count) {
  const [r, g, b] = colors
  for (let i = 1; i < count; i++) {
    if (colors[i * 4] !== r || colors[i * 4 + 1] !== g || colors[i * 4 + 2] !== b) return null
  }
  return count > 0 ? [r, g, b] : null
}
