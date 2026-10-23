# laz-viewer

A minimal Vue 3 + Tailwind CSS app for viewing LAS/LAZ point clouds in a CesiumJS globe.

## Stack

- Vue 3 + Vite
- Tailwind CSS 4
- CesiumJS (via `vite-plugin-cesium`)
- `@loaders.gl/las` for in-browser LAS/LAZ parsing (LAZ decompression via bundled `laz-perf` WASM)

## Run

```bash
npm install
npm run dev
```

## How it works

- Drop a `.las`/`.laz` file onto the panel. The file's header is read first to get the
  point count and decide a decimation factor so at most ~800k points are rendered
  (kept in `src/lib/las.js`), then the point data is parsed on the main thread.
- LAS files carry no real-world coordinate reference. The point cloud's local X/Y/Z is
  treated as East/North/Up offsets from an anchor point on the globe that you can adjust
  in the "Placement" panel (`src/lib/pointCloudScene.js`).
- Points are colored by their RGB attribute if present, otherwise by height.

## Known limitations

- Only LAS versions 1.0-1.3 are supported (the underlying parser does not support 1.4).
- Files are loaded fully into memory in the browser tab, so this only works for files up
  to roughly 1.5 GiB. Multi-gigabyte point clouds need to be tiled/converted (e.g. with
  PotreeConverter or py3dtiles into Cesium 3D Tiles) before they can be streamed to a browser.
- Placement is an approximation, not a real georeference, since LAS/LAZ has no CRS metadata
  this app resolves.
