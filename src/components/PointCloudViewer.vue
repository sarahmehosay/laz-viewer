<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { peekLasHeader, loadLasPointCloud, MAX_FILE_SIZE, MAX_RENDER_POINTS } from '../lib/las'
import { addPointCloudToScene, flyToBoundingSphere } from '../lib/pointCloudScene'

const cesiumContainer = ref(null)
const fileInput = ref(null)
const isDragging = ref(false)
const isLoading = ref(false)
const statusText = ref('')
const errorText = ref('')
const fileInfo = ref(null)

const anchor = ref({ lat: 35.6586, lon: 139.7454, height: 0 })

let viewer = null
let currentCollection = null

onMounted(() => {
  viewer = new Cesium.Viewer(cesiumContainer.value, {
    imageryProvider: new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    }),
    baseLayerPicker: false,
    geocoder: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
  })
})

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

async function handleFile(file) {
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

  isLoading.value = true
  try {
    statusText.value = 'Reading header...'
    const header = await peekLasHeader(file)

    statusText.value = `Parsing ${header.pointsCount.toLocaleString()} points...`
    const cloud = await loadLasPointCloud(file, header, { maxPoints: MAX_RENDER_POINTS })

    statusText.value = 'Building scene...'
    const { collection, boundingSphere } = addPointCloudToScene(viewer, cloud, anchor.value)
    currentCollection = collection
    flyToBoundingSphere(viewer, boundingSphere)

    fileInfo.value = {
      name: file.name,
      totalPoints: header.pointsCount,
      renderedPoints: cloud.renderedCount,
      skip: cloud.skip,
      hasColor: header.hasColor,
    }
    statusText.value = ''
  } catch (err) {
    errorText.value = err.message || String(err)
    statusText.value = ''
  } finally {
    isLoading.value = false
  }
}

function onFileInputChange(e) {
  handleFile(e.target.files?.[0])
}

function onDrop(e) {
  isDragging.value = false
  handleFile(e.dataTransfer?.files?.[0])
}

function reapplyAnchor() {
  if (fileInfo.value) {
    statusText.value = 'Re-parsing with new placement...'
    handleFile(fileInput.value.files[0])
  }
}
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="cesiumContainer" class="h-full w-full"></div>

    <div
      class="absolute top-4 left-4 w-80 rounded-lg bg-white/95 p-4 shadow-lg backdrop-blur-sm dark:bg-slate-900/95"
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
      </div>

      <details class="mt-3 text-sm">
        <summary class="cursor-pointer text-slate-600 dark:text-slate-300">Placement (anchor on globe)</summary>
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
          LAS files don't carry real-world geolocation, so the point cloud's local X/Y/Z is placed
          as East/North/Up offsets from this anchor.
        </p>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <label class="flex flex-col text-xs text-slate-500 dark:text-slate-400">
            Lat
            <input v-model.number="anchor.lat" type="number" step="0.0001" class="rounded border px-1 py-0.5 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <label class="flex flex-col text-xs text-slate-500 dark:text-slate-400">
            Lon
            <input v-model.number="anchor.lon" type="number" step="0.0001" class="rounded border px-1 py-0.5 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <label class="flex flex-col text-xs text-slate-500 dark:text-slate-400">
            Height (m)
            <input v-model.number="anchor.height" type="number" step="1" class="rounded border px-1 py-0.5 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
        </div>
        <button
          class="mt-2 w-full rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600 disabled:opacity-50"
          :disabled="!fileInfo"
          @click="reapplyAnchor"
        >
          Reload at new anchor
        </button>
      </details>
    </div>
  </div>
</template>
