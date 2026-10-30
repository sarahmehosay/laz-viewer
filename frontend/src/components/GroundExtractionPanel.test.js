import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GroundExtractionPanel from './GroundExtractionPanel.vue'
import * as api from '../lib/groundApi'

vi.mock('../lib/groundApi', async (importOriginal) => ({
  DEFAULT_GROUND_PARAMS: (await importOriginal()).DEFAULT_GROUND_PARAMS,
  startGroundJob: vi.fn(),
  getGroundJob: vi.fn(),
  fetchGroundResult: vi.fn(),
  deleteGroundJob: vi.fn(),
}))

const STATS = { ground_points: 900, nonground_points: 100, ground_ratio: 0.9 }
const source = new File(['LASF'], 'cloud.las')

const extractButton = (w) => w.findAll('button').find((b) => /Extract|Re-run/.test(b.text()))
const button = (w, text) => w.findAll('button').find((b) => b.text() === text)

async function startAndFinish(wrapper) {
  api.getGroundJob.mockResolvedValue({ status: 'done', progress: 1, message: 'Done', stats: STATS })
  await extractButton(wrapper).trigger('click')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(800)
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.startGroundJob.mockResolvedValue('job-1')
  api.fetchGroundResult.mockImplementation(async (_id, kind) => new File(['LASF'], `${kind}.las`))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GroundExtractionPanel', () => {
  it('asks for a file when none is loaded', () => {
    const w = mount(GroundExtractionPanel)
    expect(w.text()).toContain('Load a file first.')
    expect(extractButton(w)).toBeUndefined()
  })

  it('starts a job with the source file and default params', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    api.getGroundJob.mockResolvedValue({ status: 'running', progress: 0.5, message: 'Opening' })

    await extractButton(w).trigger('click')
    await flushPromises()

    expect(api.startGroundJob).toHaveBeenCalledWith(source, api.DEFAULT_GROUND_PARAMS)
    expect(extractButton(w).text()).toBe('Extracting…')
    expect(extractButton(w).attributes('disabled')).toBeDefined()

    await vi.advanceTimersByTimeAsync(800)
    expect(w.text()).toContain('Opening')
  })

  it('sends edited parameters', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await w.find('input[type="number"]').setValue('2.5')
    await extractButton(w).trigger('click')
    expect(api.startGroundJob.mock.calls[0][1]).toMatchObject({ cell_size: 2.5 })
  })

  it('shows the ground result and stats when the job finishes', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await startAndFinish(w)

    expect(api.fetchGroundResult).toHaveBeenCalledWith('job-1', 'ground')
    expect(w.emitted('show')[0][0].name).toBe('ground.las')
    expect(w.text()).toContain('90.0% ground')
    expect(extractButton(w).text()).toBe('Re-run extraction')

    // Polling stops once done.
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.getGroundJob).toHaveBeenCalledTimes(1)
  })

  it('switches between original, ground and non-ground views', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await startAndFinish(w)

    await button(w, 'Non-ground').trigger('click')
    await flushPromises()
    expect(w.emitted('show').at(-1)[0].name).toBe('nonground.las')

    await button(w, 'original').trigger('click')
    expect(w.emitted('show-source')).toHaveLength(1)
  })

  it('shows the backend error when the job fails', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    api.getGroundJob.mockResolvedValue({ status: 'error', error: 'Point cloud is empty.' })

    await extractButton(w).trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()

    expect(w.text()).toContain('Point cloud is empty.')
    expect(extractButton(w).attributes('disabled')).toBeUndefined()
  })

  it('shows an error when the upload fails', async () => {
    api.startGroundJob.mockRejectedValue(new Error('Backend error (400): bad file'))
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await extractButton(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Backend error (400): bad file')
  })

  it('discards the job when a new source file is loaded', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await startAndFinish(w)

    await w.setProps({ sourceFile: new File(['LASF'], 'other.las') })
    expect(api.deleteGroundJob).toHaveBeenCalledWith('job-1')
    expect(w.text()).not.toContain('% ground')
  })

  it('deletes the job on unmount', async () => {
    const w = mount(GroundExtractionPanel, { props: { sourceFile: source } })
    await startAndFinish(w)
    w.unmount()
    expect(api.deleteGroundJob).toHaveBeenCalledWith('job-1')
  })
})
