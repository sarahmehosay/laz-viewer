import { describe, expect, it, vi } from 'vitest'
import { builtInCrs, resolveCrs, wktEpsg, wktHorizontal, wktVerticalUnitsToMetres } from './crs'

// WKT as written by real LAS 1.4 files (PDAL / LAStools).
const JGD_IX_WKT =
  'COMPD_CS["JGD2011 / Japan Plane Rectangular CS IX + unknown",PROJCS["JGD2011 / Japan Plane Rectangular CS IX",' +
  'GEOGCS["JGD2011",DATUM["Japanese_Geodetic_Datum_2011",SPHEROID["GRS 1980",6378137,298.257222101,' +
  'AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1128"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","6668"]],' +
  'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",36],PARAMETER["central_meridian",139.833333333333],' +
  'PARAMETER["scale_factor",0.9999],PARAMETER["false_easting",0],PARAMETER["false_northing",0],' +
  'UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Northing",NORTH],AXIS["Easting",EAST],AUTHORITY["EPSG","6677"]],' +
  'VERT_CS["",VERT_DATUM["unknown",2005],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Up",UP]]]'
const ALBERS_WKT =
  'COMPD_CS["NAD83(2011) / Conus Albers + NAVD88 height (ftUS)",PROJCS["NAD83(2011) / Conus Albers",' +
  'GEOGCS["NAD83(2011)",DATUM["NAD83_National_Spatial_Reference_System_2011",SPHEROID["GRS 1980",6378137,' +
  '298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],' +
  'PARAMETER["standard_parallel_1",29.5],PARAMETER["standard_parallel_2",45.5],PARAMETER["latitude_of_center",23],' +
  'PARAMETER["longitude_of_center",-96],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],' +
  'AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","6350"]],VERT_CS["NAVD88 height (ftUS)",' +
  'VERT_DATUM["North American Vertical Datum 1988",2005],UNIT["US survey foot",0.304800609601219],AXIS["Up",UP]]]'

const noNetwork = () => Promise.reject(new Error('network disabled in this test'))

describe('built-in CRSs', () => {
  // Reference values from PROJ (pyproj, always_xy), independent of proj4js.
  it.each([
    [6675, [15000, -131000], 34.8190393, 137.3306377], // JGD2011 / JPRCS VII, Toyokawa
    [6681, [-23702, 155734], 45.401158, 143.9472417], // JGD2011 / JPRCS XIII
    [32654, [500000, 3900000], 35.2430777, 141.0], // WGS 84 / UTM 54N
    [6688, [400000, 3700000], 33.4347288, 121.924236], // JGD2011 / UTM 51N
    [7855, [320000, 5810000], -37.8396882, 144.9543776], // GDA2020 / MGA 55 (southern hemisphere)
  ])('EPSG:%i converts %j to %f, %f', async (epsg, xy, lat, lon) => {
    const crs = await resolveCrs({ epsg }, { fetchImpl: noNetwork })
    const [gotLon, gotLat] = crs.toLonLat(xy)
    expect(gotLat).toBeCloseTo(lat, 6)
    expect(gotLon).toBeCloseTo(lon, 6)
  })

  it('applies the Tokyo datum shift (within PROJ transformation differences)', async () => {
    const crs = await resolveCrs({ epsg: 30169 }, { fetchImpl: noNetwork })
    const [lon, lat] = crs.toLonLat([-5000, -35000])
    expect(lat).toBeCloseTo(35.687721, 3)
    expect(lon).toBeCloseTo(139.7748507, 3)
  })

  it.each([
    [6669, 'JGD2011 / Japan Plane Rectangular CS I'],
    [6687, 'JGD2011 / Japan Plane Rectangular CS XIX'],
    [2451, 'JGD2000 / Japan Plane Rectangular CS IX'],
    [32760, 'WGS 84 / UTM zone 60S'],
  ])('names EPSG:%i', (epsg, name) => {
    expect(builtInCrs(epsg).name).toBe(name)
  })

  it('maps each Japan Plane Rectangular zone origin to its lat/lon', async () => {
    const origins = { 6669: [129.5, 33], 6677: [139 + 5 / 6, 36], 6679: [140.25, 44], 6686: [136, 20] }
    for (const [epsg, [lon, lat]] of Object.entries(origins)) {
      const [gotLon, gotLat] = (await resolveCrs({ epsg: Number(epsg) })).toLonLat([0, 0])
      expect(gotLon).toBeCloseTo(lon, 9)
      expect(gotLat).toBeCloseTo(lat, 9)
    }
  })

  it('labels the CRS and carries the vertical scale', async () => {
    const crs = await resolveCrs({ epsg: 6675, zUnitsToMetres: 0.3048 })
    expect(crs.label).toBe('EPSG:6675 · JGD2011 / Japan Plane Rectangular CS VII')
    expect(crs.zScale).toBe(0.3048)
  })

  it('rejects coordinates that fall outside the projection', async () => {
    const crs = await resolveCrs({ epsg: 32760 })
    // proj4 clamps impossible northings towards the pole, but returns Infinity for eastings like this.
    expect(() => crs.toLonLat([1e9, 0])).toThrow(/outside the valid area/)
  })
})

describe('WKT', () => {
  it('finds the horizontal CRS and its EPSG code in a compound WKT', () => {
    expect(wktHorizontal(JGD_IX_WKT)).toMatch(/^PROJCS\["JGD2011 \/ Japan Plane Rectangular CS IX"/)
    expect(wktEpsg(JGD_IX_WKT)).toBe(6677) // the PROJCS's own code, not the nested GEOGCS 6668
    expect(wktEpsg(ALBERS_WKT)).toBe(6350)
  })

  it('reads the vertical unit', () => {
    expect(wktVerticalUnitsToMetres(JGD_IX_WKT)).toBe(1)
    expect(wktVerticalUnitsToMetres(ALBERS_WKT)).toBeCloseTo(0.3048006, 6)
    expect(wktVerticalUnitsToMetres('PROJCS["x",UNIT["metre",1]]')).toBeNull()
  })

  it('uses the WKT definition for codes that are not built in, without the network', async () => {
    const fetchImpl = vi.fn(noNetwork)
    const crs = await resolveCrs({ epsg: 6350, wkt: ALBERS_WKT }, { fetchImpl })
    const [lon, lat] = crs.toLonLat([938549.5, 1376549.5])
    expect(lat).toBeCloseTo(34.9857357, 6)
    expect(lon).toBeCloseTo(-85.6125063, 6)
    expect(crs.label).toBe('EPSG:6350 · NAD83(2011) / Conus Albers')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps X as easting even when the WKT declares northing first', async () => {
    // Force the WKT path by giving no EPSG code.
    const crs = await resolveCrs({ epsg: null, wkt: JGD_IX_WKT })
    const [lon, lat] = crs.toLonLat([10000, 0]) // 10 km east of the zone IX origin
    expect(lat).toBeCloseTo(36, 3)
    expect(lon).toBeGreaterThan(139 + 5 / 6)
  })
})

describe('epsg.io fallback', () => {
  it('looks up unknown codes once and caches them', async () => {
    const fetchImpl = vi.fn(async () => new Response('+proj=longlat +ellps=GRS80 +no_defs +type=crs'))
    const a = await resolveCrs({ epsg: 999001 }, { fetchImpl })
    await resolveCrs({ epsg: 999001 }, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://epsg.io/999001.proj4')
    expect(a.label).toBe('EPSG:999001')
    expect(a.toLonLat([135, 35])).toEqual([135, 35])
  })

  it('explains when a code cannot be resolved', async () => {
    await expect(resolveCrs({ epsg: 999002 }, { fetchImpl: noNetwork })).rejects.toThrow(/EPSG:999002/)
    const notFound = async () => new Response('Not found', { status: 404 })
    await expect(resolveCrs({ epsg: 999003 }, { fetchImpl: notFound })).rejects.toThrow(/EPSG:999003/)
  })

  it('returns null when the file has no CRS', async () => {
    expect(await resolveCrs(null)).toBeNull()
  })
})
