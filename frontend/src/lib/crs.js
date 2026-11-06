import proj4 from 'proj4'

/**
 * Turns the CRS found in a LAS/LAZ file (an EPSG code and/or OGC WKT, see
 * readLasCrs in las.js) into a converter from file X/Y to WGS84 lon/lat.
 *
 * Common EPSG codes are built in so no network is needed for them; any other
 * code is looked up on epsg.io. LAS X is treated as easting and Y as northing,
 * which is what LAS writers do even for CRSs whose official axis order is N/E.
 */

const GRS80 = '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX']
// Japan Plane Rectangular CS zone origins [lat_0, lon_0], zones I-XIX
const JPRCS = [[33, 129.5], [33, 131], [36, 132 + 1 / 6], [33, 133.5], [36, 134 + 1 / 3], [36, 136],
  [36, 137 + 1 / 6], [36, 138.5], [36, 139 + 5 / 6], [40, 140 + 5 / 6], [44, 140.25], [44, 142.25],
  [44, 144.25], [26, 142], [26, 127.5], [26, 124], [26, 131], [20, 136], [26, 154]]

function builtInDefinitions() {
  const defs = new Map()
  const add = (code, name, def) => defs.set(code, { name, def })

  add(4326, 'WGS 84', '+proj=longlat +datum=WGS84 +no_defs')
  for (const [code, name] of [[4612, 'JGD2000'], [6668, 'JGD2011'], [4269, 'NAD83'], [4283, 'GDA94'], [7844, 'GDA2020']]) {
    add(code, name, `+proj=longlat ${GRS80}`)
  }

  JPRCS.forEach(([lat, lon], i) => {
    const tm = `+proj=tmerc +lat_0=${lat} +lon_0=${lon} +k=0.9999 +x_0=0 +y_0=0`
    const zone = `Japan Plane Rectangular CS ${ROMAN[i]}`
    add(6669 + i, `JGD2011 / ${zone}`, `${tm} ${GRS80}`)
    add(2443 + i, `JGD2000 / ${zone}`, `${tm} ${GRS80}`)
    add(30161 + i, `Tokyo / ${zone}`,
      `${tm} +ellps=bessel +towgs84=-146.414,507.337,680.507,0,0,0,0 +units=m +no_defs`)
  })

  for (let zone = 1; zone <= 60; zone++) {
    add(32600 + zone, `WGS 84 / UTM zone ${zone}N`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`)
    add(32700 + zone, `WGS 84 / UTM zone ${zone}S`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`)
  }
  for (let zone = 51; zone <= 55; zone++) {
    add(6688 + zone - 51, `JGD2011 / UTM zone ${zone}N`, `+proj=utm +zone=${zone} ${GRS80}`)
    add(3097 + zone - 51, `JGD2000 / UTM zone ${zone}N`, `+proj=utm +zone=${zone} ${GRS80}`)
  }
  for (let zone = 1; zone <= 23; zone++) {
    add(26900 + zone, `NAD83 / UTM zone ${zone}N`, `+proj=utm +zone=${zone} ${GRS80}`)
  }
  for (let zone = 48; zone <= 58; zone++) add(28300 + zone, `GDA94 / MGA zone ${zone}`, `+proj=utm +zone=${zone} +south ${GRS80}`)
  for (let zone = 46; zone <= 59; zone++) add(7800 + zone, `GDA2020 / MGA zone ${zone}`, `+proj=utm +zone=${zone} +south ${GRS80}`)
  return defs
}

const BUILT_IN = builtInDefinitions()
const fetched = new Map() // EPSG code -> Promise<definition | null>

export function builtInCrs(code) {
  return BUILT_IN.get(code) ?? null
}

async function lookupEpsg(code, fetchImpl) {
  if (!fetched.has(code)) {
    fetched.set(code, (async () => {
      const res = await fetchImpl(`https://epsg.io/${code}.proj4`)
      const def = res.ok ? (await res.text()).trim() : ''
      return def.startsWith('+') ? { name: null, def } : null
    })().catch(() => null))
  }
  return fetched.get(code)
}

/**
 * crsInfo: { epsg, wkt, zUnitsToMetres } from readLasCrs.
 * Returns { code, name, label, toLonLat([x, y]) => [lon, lat], zScale } or throws
 * if the file names a CRS that can't be resolved.
 */
export async function resolveCrs(crsInfo, { fetchImpl = globalThis.fetch } = {}) {
  if (!crsInfo) return null
  const { epsg, wkt } = crsInfo
  const wktName = wkt ? wktCrsName(wkt) : null

  let entry = epsg ? builtInCrs(epsg) : null
  if (!entry && wkt) {
    // proj4 understands WKT1 PROJCS/GEOGCS; compound CRSs need the horizontal part only.
    // AXIS is dropped: many CRSs declare northing first, but LAS X is always easting.
    const horizontal = wktHorizontal(wkt).replace(/,\s*AXIS\[[^\]]*\]/gi, '')
    try {
      proj4(horizontal, 'WGS84')
      entry = { name: wktName, def: horizontal }
    } catch {
      // fall through to the EPSG lookup
    }
  }
  if (!entry && epsg) entry = await lookupEpsg(epsg, fetchImpl)
  if (!entry) {
    throw new Error(
      epsg
        ? `Could not find a definition for EPSG:${epsg} (offline, or not a known code).`
        : 'The file has a WKT CRS this viewer could not parse.'
    )
  }

  const converter = proj4(entry.def, 'WGS84')
  const name = entry.name ?? wktName
  return {
    code: epsg,
    name,
    label: [epsg && `EPSG:${epsg}`, name].filter(Boolean).join(' · '),
    zScale: crsInfo.zUnitsToMetres ?? 1,
    toLonLat(xy) {
      const ll = converter.forward(xy)
      if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || Math.abs(ll[1]) > 90) {
        throw new Error(`Coordinates (${xy.join(', ')}) are outside the valid area of ${name || `EPSG:${epsg}`}.`)
      }
      return ll
    },
  }
}

// ---------- WKT helpers ----------

/** Splits `KEYWORD[...]` into its top-level comma-separated children. */
function wktChildren(node) {
  const open = node.indexOf('[')
  const body = node.slice(open + 1, node.lastIndexOf(']'))
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '[' || ch === '(')) depth++
    else if (!quoted && (ch === ']' || ch === ')')) depth--
    else if (!quoted && ch === ',' && depth === 0) {
      parts.push(body.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(body.slice(start).trim())
  return parts
}

const keyword = (node) => node.slice(0, node.indexOf('[')).trim().toUpperCase()

/** The horizontal CRS of a (possibly compound) WKT. */
export function wktHorizontal(wkt) {
  const root = wkt.trim()
  if (!/^COMPD_CS|^COMPOUNDCRS/i.test(root)) return root
  return wktChildren(root).find((c) => /^(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\[/i.test(c)) ?? root
}

/** EPSG code of the horizontal CRS, from AUTHORITY["EPSG","n"] or ID["EPSG",n]. */
export function wktEpsg(wkt) {
  const node = wktHorizontal(wkt)
  for (const child of wktChildren(node).reverse()) {
    const kw = keyword(child)
    if (kw === 'AUTHORITY' || kw === 'ID') {
      const [auth, code] = wktChildren(child).map((s) => s.replace(/"/g, ''))
      if (auth.toUpperCase() === 'EPSG' && /^\d+$/.test(code)) return Number(code)
    }
  }
  return null
}

function wktCrsName(wkt) {
  const m = /^[A-Z_]+\[\s*"([^"]*)"/i.exec(wktHorizontal(wkt))
  return m ? m[1] : null
}

/** Metres per vertical unit from a compound WKT's VERT_CS, or null if none/unknown. */
export function wktVerticalUnitsToMetres(wkt) {
  const root = wkt.trim()
  if (!/^COMPD_CS|^COMPOUNDCRS/i.test(root)) return null
  const vert = wktChildren(root).find((c) => /^(VERT_CS|VERTCRS)\[/i.test(c))
  const unit = vert && wktChildren(vert).find((c) => /^(UNIT|LENGTHUNIT)\[/i.test(c))
  if (!unit) return null
  const factor = Number(wktChildren(unit)[1])
  return Number.isFinite(factor) && factor > 0 ? factor : null
}
