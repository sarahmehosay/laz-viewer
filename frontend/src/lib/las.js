// laz-rs (WASM) rather than the default laz-perf build: it decodes LAS/LAZ 1.4
// and point data formats 4-10, which laz-perf's loader does not.
import { LAZRsLoader } from '@loaders.gl/las'

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
  }
}

/**
 * Parses the full point data, decimating on the fly so the rendered point
 * count stays within maxPoints regardless of the source file's size.
 */
export async function loadLasPointCloud(file, header, { maxPoints = MAX_RENDER_POINTS } = {}) {
  const skip = Math.max(1, Math.ceil(header.pointsCount / maxPoints))
  const arrayBuffer = await file.arrayBuffer()
  const mesh = await LAZRsLoader.parse(arrayBuffer, {
    las: { skip, colorDepth: 'auto', fp64: false },
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
