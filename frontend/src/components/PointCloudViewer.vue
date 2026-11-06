<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { peekLasHeader, loadLasPointCloud, readLasCrs, MAX_FILE_SIZE, MAX_RENDER_POINTS } from '../lib/las'
import { builtInCrs, resolveCrs } from '../lib/crs'
import GroundExtractionPanel from './GroundExtractionPanel.vue' // disabled, see template
import { addPointCloudToScene, flyToBoundingSphere } from '../lib/pointCloudScene'

const cesiumContainer = ref(null)
const fileInput = ref(null)
const isDragging = ref(false)
const isLoading = ref(false)
const statusText = ref('')
const errorText = ref('')
const fileInfo = ref(null)
const sourceFile = ref(null) // original user-selected file (input for ground extraction)
const displayedFile = ref(null) // whatever is currently rendered (source or a derived result)

// Optional demo cloud: the first .las/.laz in frontend/demo is loaded on start.
// (An empty glob when the folder has no such file.)
const demoFiles = import.meta.glob('../../demo/*.{las,laz}', { query: '?url', import: 'default', eager: true })

const anchor = ref({ lat: 35.6586, lon: 139.7454, height: 0 })
// How the cloud is put on the globe: the file's own CRS, an EPSG code the user
// types (for files whose CRS is missing or wrong), or the manual anchor above.
const placementMode = ref('file') // file | epsg | anchor
const epsgOverride = ref(null)

let viewer = null
let currentCollection = null

onMounted(() => {
  viewer = new Cesium.Viewer(cesiumContainer.value, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
  })
  // Map imagery is always loaded but only shown for georeferenced clouds.
  viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
  )
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#6b7280')
  showGlobe(false)

  loadDemo()
})

/** Globe (map) when the cloud is at its real-world location, plain gray otherwise. */
function showGlobe(show) {
  const { scene } = viewer
  scene.globe.show = show
  scene.skyBox.show = show
  scene.skyAtmosphere.show = show
  scene.sun.show = show
  scene.moon.show = show
  scene.fog.enabled = show
}

async function loadDemo() {
  const [path] = Object.keys(demoFiles).sort()
  if (!path) return
  try {
    const res = await fetch(demoFiles[path])
    if (!res.ok) return
    const blob = await res.blob()
    // Guard against dev servers answering with index.html for a missing file.
    if (blob.type.includes('html')) return
    await handleFile(new File([blob], path.split('/').pop()))
  } catch {
    // demo is best-effort
  }
}

onBeforeUnmount(() => {
  viewer?.destroy()
})

function clearPointCloud() {
  if (currentCollection) {
    viewer.scene.primitives.remove(currentCollection)
    currentCollection = null
  }
  fileInfo.value = null
  statusText.value = ''
  errorText.value = ''
}

async function handleFile(file, { derived = false } = {}) {
  if (!file) return
  clearPointCloud()
  errorText.value = ''

  const name = file.name.toLowerCase()
  if (!name.endsWith('.las') && !name.endsWith('.laz')) {
    errorText.value = 'Please choose a .las or .laz file.'
    return
  }
  if (file.size > MAX_FILE_SIZE) {
    errorText.value = `File is ${(file.size / 1024 ** 3).toFixed(1)} GiB, which is too large to load in a browser tab. Try a file under ${(MAX_FILE_SIZE / 1024 ** 3).toFixed(1)} GiB, or pre-decimate/tile it first.`
    return
  }

  if (!derived) sourceFile.value = file
  displayedFile.value = file
  isLoading.value = true
  try {
    statusText.value = 'Reading header...'
    const header = await peekLasHeader(file)

    const fileCrs = await readLasCrs(file, header).catch(() => null)

    statusText.value = `Parsing ${header.pointsCount.toLocaleString()} points...`
    const cloud = await loadLasPointCloud(file, header, { maxPoints: MAX_RENDER_POINTS })

    statusText.value = 'Building scene...'
    const { crs, crsWarning } = await chooseCrs(fileCrs)
    let placed
    let georeferenced = !!crs
    try {
      placed = addPointCloudToScene(viewer, cloud, anchor.value, crs)
    } catch (err) {
      if (!crs) throw err
      // e.g. local coordinates labelled with a CRS they don't fit
      placed = addPointCloudToScene(viewer, cloud, anchor.value)
      georeferenced = false
      fileInfoWarning = `${err.message} Placed at the manual anchor instead.`
    }
    currentCollection = placed.collection
    showGlobe(georeferenced)
    flyToBoundingSphere(viewer, placed.boundingSphere)

    fileInfo.value = {
      name: file.name,
      totalPoints: header.pointsCount,
      renderedPoints: cloud.renderedCount,
      skip: cloud.skip,
      hasColor: !!cloud.colors,
      blankColor: cloud.blankColor,
      fileCrsLabel: fileCrs && crsLabel(fileCrs),
      placedBy: fileInfoWarning ? null : crs?.label ?? null,
      crsWarning: fileInfoWarning ?? crsWarning,
    }
    fileInfoWarning = null
    statusText.value = ''
  } catch (err) {
    errorText.value = err.message || String(err)
    statusText.value = ''
  } finally {
    isLoading.value = false
  }
}

let fileInfoWarning = null

function crsLabel(info) {
  if (!info.epsg) return 'WKT (no EPSG code)'
  const name = builtInCrs(info.epsg)?.name
  return name ? `EPSG:${info.epsg} · ${name}` : `EPSG:${info.epsg}`
}

/** Resolves the CRS for the current placement mode; falls back to the anchor with a warning. */
async function chooseCrs(fileCrs) {
  try {
    if (placementMode.value === 'file' && fileCrs) return { crs: await resolveCrs(fileCrs), crsWarning: null }
    if (placementMode.value === 'epsg') {
      if (!Number.isInteger(epsgOverride.value) || epsgOverride.value <= 0) {
        return { crs: null, crsWarning: 'Enter an EPSG code (e.g. 6675). Placed at the manual anchor.' }
      }
      const zUnitsToMetres = fileCrs?.zUnitsToMetres ?? 1
      return { crs: await resolveCrs({ epsg: epsgOverride.value, zUnitsToMetres }), crsWarning: null }
    }
  } catch (err) {
    return { crs: null, crsWarning: `${err.message} Placed at the manual anchor instead.` }
  }
  return { crs: null, crsWarning: null }
}

function onFileInputChange(e) {
  placementMode.value = 'file'
  handleFile(e.target.files?.[0])
}

function onDrop(e) {
  isDragging.value = false
  placementMode.value = 'file'
  handleFile(e.dataTransfer?.files?.[0])
}

function reapplyAnchor() {
  if (fileInfo.value) {
    statusText.value = 'Re-parsing with new placement...'
    handleFile(displayedFile.value, { derived: displayedFile.value !== sourceFile.value })
  }
}
</script>

<template>
  <!-- Small screens: panel stacked above the viewer. md and up: panel floats over it. -->
  <div class="relative flex h-full w-full flex-col md:block">
    <div
      class="order-first max-h-[45vh] w-full shrink-0 overflow-y-auto bg-white/95 p-4 shadow-lg dark:bg-slate-900/95 md:absolute md:top-4 md:left-4 md:z-10 md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-lg md:backdrop-blur-sm"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <h1 class="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">LAS/LAZ Point Cloud Viewer</h1>

      <label
        class="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm transition-colors"
        :class="isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-300 dark:border-slate-600'"
      >
        <span class="text-slate-600 dark:text-slate-300">Drop a .las / .laz file here, or click to choose</span>
        <input
          ref="fileInput"
          type="file"
          accept=".las,.laz"
          class="hidden"
          @change="onFileInputChange"
        />
      </label>

      <div v-if="isLoading" class="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {{ statusText }}
      </div>
      <div v-if="errorText" class="mt-3 text-sm text-red-600 dark:text-red-400">
        {{ errorText }}
      </div>

      <div v-if="fileInfo" class="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        <p class="truncate font-medium text-slate-800 dark:text-slate-100">{{ fileInfo.name }}</p>
        <p>{{ fileInfo.totalPoints.toLocaleString() }} points total</p>
        <p>{{ fileInfo.renderedPoints.toLocaleString() }} rendered (1 of every {{ fileInfo.skip }})</p>
        <p>{{ fileInfo.hasColor ? 'RGB color' : 'Colored by height' }}</p>
        <p v-if="fileInfo.blankColor" class="text-xs text-slate-500 dark:text-slate-400">
          The file's RGB is the same for every point ({{ fileInfo.blankColor.join(', ') }}), so it has no real colour.
        </p>
        <p>{{ fileInfo.placedBy ? `Placed by ${fileInfo.placedBy}` : 'Placed at the manual anchor' }}</p>
        <p v-if="fileInfo.crsWarning" class="text-xs text-amber-700 dark:text-amber-400">{{ fileInfo.crsWarning }}</p>
      </div>

      <details class="mt-3 text-sm">
        <summary class="cursor-pointer text-slate-600 dark:text-slate-300">Placement on globe</summary>
        <div class="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
          <label class="flex items-start gap-2">
            <input v-model="placementMode" type="radio" value="file" class="mt-0.5" :disabled="fileInfo && !fileInfo.fileCrsLabel" />
            <span>
              File's CRS
              <span class="block text-slate-500 dark:text-slate-400">
                {{ !fileInfo ? 'Read from the file when it loads' : fileInfo.fileCrsLabel || 'None in this file' }}
              </span>
            </span>
          </label>
          <label class="flex items-center gap-2">
            <input v-model="placementMode" type="radio" value="epsg" />
            <span>EPSG code</span>
            <input
              v-model.number="epsgOverride"
              type="number"
              min="1"
              placeholder="e.g. 6675"
              class="w-24 rounded border px-1 py-0.5 text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              :disabled="placementMode !== 'epsg'"
            />
          </label>
          <label class="flex items-start gap-2">
            <input v-model="placementMode" type="radio" value="anchor" class="mt-0.5" />
            <span>
              Manual anchor
              <span class="block text-slate-500 dark:text-slate-400">
                Local X/Y/Z become East/North/Up offsets from this point.
              </span>
            </span>
          </label>
          <div class="grid grid-cols-3 gap-2 pl-5">
            <label class="flex flex-col text-slate-500 dark:text-slate-400">
              Lat
              <input v-model.number="anchor.lat" type="number" step="0.0001" class="rounded border px-1 py-0.5 text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" :disabled="placementMode !== 'anchor'" />
            </label>
            <label class="flex flex-col text-slate-500 dark:text-slate-400">
              Lon
              <input v-model.number="anchor.lon" type="number" step="0.0001" class="rounded border px-1 py-0.5 text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" :disabled="placementMode !== 'anchor'" />
            </label>
            <label class="flex flex-col text-slate-500 dark:text-slate-400">
              Height (m)
              <input v-model.number="anchor.height" type="number" step="1" class="rounded border px-1 py-0.5 text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" :disabled="placementMode !== 'anchor'" />
            </label>
          </div>
        </div>
        <button
          class="mt-2 w-full rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600 disabled:opacity-50"
          :disabled="!fileInfo || isLoading"
          @click="reapplyAnchor"
        >
          Apply placement
        </button>
      </details>
      <GroundExtractionPanel
        :source-file="sourceFile"
        @show="(f) => handleFile(f, { derived: true })"
        @show-source="handleFile(sourceFile)"
      />
    </div>

    <div ref="cesiumContainer" class="min-h-0 w-full flex-1 md:h-full"></div>
  </div>
</template>
