# laz-viewer

A minimal Vue 3 + Tailwind CSS app for viewing LAS/LAZ point clouds in a CesiumJS globe.

## Stack

- Vue 3 + Vite
- Tailwind CSS 4
- CesiumJS (via `vite-plugin-cesium`)
- `@loaders.gl/las` for in-browser LAS/LAZ parsing (its `LAZRsLoader`: LAZ decompression via the bundled `laz-rs` WASM)

## Run

```bash
npm install
npm run dev
```

## Tests

```bash
npm test            # run once
npm run test:watch  # re-run on change
```

Vitest + Vue Test Utils in happy-dom (`vitest.config.js`). Tests sit next to the code as
`*.test.js`; `src/lib/testing/lasFixture.js` builds small LAS files in memory, and the
backend is mocked, so no server is needed.

## How it works

- Drop a `.las`/`.laz` file onto the panel. The file's header is read first to get the
  point count and decide a decimation factor so at most ~800k points are rendered
  (kept in `src/lib/las.js`), then the point data is parsed on the main thread.
- The file's CRS is read from its VLRs: the OGC WKT record (LAS 1.4, also as an EVLR) or
  the GeoTIFF GeoKeyDirectory (EPSG code + vertical units). Points are projected to WGS84
  with `proj4` and placed at their real position (`src/lib/crs.js`). Common EPSG codes are
  built in (JGD2000/JGD2011/Tokyo Japan Plane Rectangular CS I-XIX, JGD UTM, WGS 84 UTM,
  NAD83 UTM, GDA94/GDA2020 MGA); WKT is used directly when present; any other code is
  looked up on epsg.io.
- In "Placement on globe" you can override the file's CRS with another EPSG code (some
  scanners write the wrong zone), or use a manual anchor: local X/Y/Z become East/North/Up
  offsets from a point you choose. Files without a CRS use the anchor.
- Points are colored by their RGB attribute if present, otherwise by height.

## Known limitations

- LAS/LAZ 1.0-1.4 with point data formats 0-10 are supported. Extra bytes, waveform data
  (formats 4, 5, 9, 10) and NIR (format 8) are ignored; only position and RGB are drawn.
- Files are loaded fully into memory in the browser tab, so this only works for files up
  to roughly 1.5 GiB. Multi-gigabyte point clouds need to be tiled/converted (e.g. with
  PotreeConverter or py3dtiles into Cesium 3D Tiles) before they can be streamed to a browser.
- Z is drawn as height above the WGS84 ellipsoid. Most survey data uses orthometric heights
  (e.g. Japan's T.P.), so clouds sit tens of metres off true ellipsoidal height; this is not
  visible on the current terrain-less globe but would be with a terrain provider.
- Horizontal datum shifts are the 3/7-parameter approximations in proj4 (no grid files), so
  Tokyo-datum and NAD27 data can be off by a few metres.
