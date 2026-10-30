<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  DEFAULT_GROUND_PARAMS,
  startGroundJob,
  getGroundJob,
  fetchGroundResult,
  deleteGroundJob,
} from '../lib/groundApi'

const props = defineProps({
  // The original (user-selected) LAS/LAZ file to run extraction on.
  sourceFile: { type: File, default: null },
})
// show: display a File in the viewer; showSource: go back to the original.
const emit = defineEmits(['show', 'show-source'])

const params = ref({ ...DEFAULT_GROUND_PARAMS })
const jobId = ref(null)
const job = ref(null)
const errorText = ref('')
const view = ref('original') // original | ground | nonground
let timer = null

const running = computed(() => job.value && ['queued', 'running'].includes(job.value.status))
const done = computed(() => job.value?.status === 'done')

const fields = [
  { key: 'cell_size', label: 'Cell size (m)', step: 0.1, hint: 'Raster resolution. Larger = faster, coarser terrain.' },
  { key: 'max_window', label: 'Max object size (m)', step: 1, hint: 'Largest building/structure to remove.' },
  { key: 'slope', label: 'Terrain slope', step: 0.01, hint: 'Rise/run. Raise for steep terrain.' },
  { key: 'initial_threshold', label: 'Initial height diff (m)', step: 0.05, hint: 'Elevation change that marks an object at small scale.' },
  { key: 'max_threshold', label: 'Max height diff (m)', step: 0.1, hint: 'Upper cap on the height-difference threshold.' },
  { key: 'point_threshold', label: 'Point tolerance (m)', step: 0.05, hint: 'Max height above surface for a point to count as ground.' },
]

function stopPolling() {
  clearInterval(timer)
  timer = null
}

async function cleanupJob() {
  stopPolling()
  if (jobId.value) deleteGroundJob(jobId.value)
  jobId.value = null
  job.value = null
  view.value = 'original'
}

async function run() {
  if (!props.sourceFile) return
  errorText.value = ''
  const wasDerived = view.value !== 'original'
  await cleanupJob()
  if (wasDerived) emit('show-source')
  try {
    jobId.value = await startGroundJob(props.sourceFile, params.value)
    job.value = { status: 'queued', progress: 0, message: 'Uploaded' }
    timer = setInterval(poll, 800)
  } catch (err) {
    errorText.value = err.message
  }
}

async function poll() {
  try {
    job.value = await getGroundJob(jobId.value)
    if (job.value.status === 'done') {
      stopPolling()
      await setView('ground')
    } else if (job.value.status === 'error') {
      stopPolling()
      errorText.value = job.value.error
    }
  } catch (err) {
    stopPolling()
    errorText.value = err.message
  }
}

async function setView(next) {
  errorText.value = ''
  try {
    if (next === 'original') emit('show-source')
    else emit('show', await fetchGroundResult(jobId.value, next))
    view.value = next
  } catch (err) {
    errorText.value = err.message
  }
}

async function download(kind) {
  const file = await fetchGroundResult(jobId.value, kind)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  URL.revokeObjectURL(a.href)
}

// A new source file invalidates any previous result.
watch(() => props.sourceFile, cleanupJob)
onBeforeUnmount(cleanupJob)
</script>

<template>
  <div class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
    <h2 class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Ground extraction</h2>

    <p v-if="!sourceFile" class="text-xs text-slate-500 dark:text-slate-400">Load a file first.</p>

    <template v-else>
      <details class="text-sm">
        <summary class="cursor-pointer text-slate-600 dark:text-slate-300">Parameters</summary>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label
            v-for="f in fields"
            :key="f.key"
            class="flex flex-col text-xs text-slate-500 dark:text-slate-400"
            :title="f.hint"
          >
            {{ f.label }}
            <input
              v-model.number="params[f.key]"
              type="number"
              :step="f.step"
              min="0"
              class="rounded border px-1 py-0.5 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        </div>
        <button class="mt-2 text-xs text-slate-500 underline" @click="params = { ...DEFAULT_GROUND_PARAMS }">
          Reset defaults
        </button>
      </details>

      <button
        class="mt-2 w-full rounded bg-emerald-700 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
        :disabled="running"
        @click="run"
      >
        {{ running ? 'Extracting…' : done ? 'Re-run extraction' : 'Extract ground' }}
      </button>

      <div v-if="running" class="mt-2">
        <div class="h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
          <div class="h-full bg-emerald-500 transition-all" :style="{ width: `${(job.progress || 0) * 100}%` }"></div>
        </div>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{{ job.message }}</p>
      </div>

      <div v-if="done" class="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <p>
          {{ job.stats.ground_points.toLocaleString() }} ground /
          {{ job.stats.nonground_points.toLocaleString() }} non-ground
          ({{ (job.stats.ground_ratio * 100).toFixed(1) }}% ground)
        </p>
        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="v in ['original', 'ground', 'nonground']"
            :key="v"
            class="rounded py-1 text-xs capitalize"
            :class="view === v ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'"
            @click="setView(v)"
          >
            {{ v === 'nonground' ? 'Non-ground' : v }}
          </button>
        </div>
        <div class="grid grid-cols-2 gap-1">
          <button class="rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600" @click="download('ground')">
            Download ground .las
          </button>
          <button class="rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600" @click="download('nonground')">
            Download non-ground
          </button>
        </div>
      </div>

      <p v-if="errorText" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ errorText }}</p>
    </template>
  </div>
</template>
