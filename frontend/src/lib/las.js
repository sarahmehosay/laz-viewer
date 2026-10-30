import { LASLoader } from '@loaders.gl/las'

export const MAX_FILE_SIZE = 1.5 * 1024 ** 3 // 1.5 GiB, practical browser ArrayBuffer limit
export const MAX_RENDER_POINTS = 800_000 // interactive cap for PointPrimitiveCollection

const SUPPORTED_POINT_FORMATS = new Set([0, 1, 2, 3])

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
  if (versionMajor * 10 + versionMinor > 13) {
    throw new Error(
      `LAS ${versionMajor}.${versionMinor} is not supported (this viewer only supports LAS 1.0-1.3).`
    )
  }

  const pointsFormatIdRaw = dv.getUint8(104)
  const pointsFormatId = pointsFormatIdRaw & 0x3f
  const isCompressed = ((pointsFormatIdRaw & 0x80) >> 7) === 1 || ((pointsFormatIdRaw & 0x40) >> 6) === 1
  const pointsCount = dv.getUint32(107, true)
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
    hasColor: pointsFormatId === 2 || pointsFormatId === 3,
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
  const mesh = await LASLoader.parse(arrayBuffer, {
    las: { skip, colorDepth: 'auto', fp64: false },
  })

  return {
    positions: mesh.attributes.POSITION.value,
    colors: mesh.attributes.COLOR_0 ? mesh.attributes.COLOR_0.value : null,
    boundingBox: mesh.header.boundingBox,
    renderedCount: mesh.header.vertexCount,
    skip,
  }
}
