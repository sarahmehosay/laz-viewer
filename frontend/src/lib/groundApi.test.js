import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GROUND_PARAMS,
  deleteGroundJob,
  fetchGroundResult,
  getGroundJob,
  startGroundJob,
} from './groundApi'

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('startGroundJob', () => {
  it('uploads the file and params as multipart form data', async () => {
    fetchMock.mockResolvedValue(json({ id: 'abc' }, { status: 202 }))
    const file = new File(['LASF'], 'cloud.laz')

    expect(await startGroundJob(file, DEFAULT_GROUND_PARAMS)).toBe('abc')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ground-jobs')
    expect(init.method).toBe('POST')
    const form = init.body
    expect(form.get('file').name).toBe('cloud.laz')
    expect(form.get('cell_size')).toBe('1')
    expect(form.get('slope')).toBe('0.15')
  })

  it('surfaces a string error detail from the backend', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Only .las / .laz files are supported.' }, { status: 400 }))
    await expect(startGroundJob(new File([''], 'a.las'), {})).rejects.toThrow(
      'Backend error (400): Only .las / .laz files are supported.'
    )
  })

  it('stringifies structured validation errors', async () => {
    const detail = [{ loc: ['body', 'cell_size'], msg: 'too small' }]
    fetchMock.mockResolvedValue(json({ detail }, { status: 422 }))
    await expect(startGroundJob(new File([''], 'a.las'), {})).rejects.toThrow(
      `Backend error (422): ${JSON.stringify(detail)}`
    )
  })

  it('falls back to the status text for non-JSON errors', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(startGroundJob(new File([''], 'a.las'), {})).rejects.toThrow('Backend error (502): Bad Gateway')
  })
})

describe('job status and results', () => {
  it('fetches job status', async () => {
    fetchMock.mockResolvedValue(json({ id: 'j1', status: 'running', progress: 0.5 }))
    expect(await getGroundJob('j1')).toMatchObject({ status: 'running', progress: 0.5 })
    expect(fetchMock).toHaveBeenCalledWith('/api/ground-jobs/j1')
  })

  it.each(['ground', 'nonground'])('downloads the %s result as a File', async (kind) => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([76, 65, 83, 70])))
    const file = await fetchGroundResult('j1', kind)
    expect(fetchMock).toHaveBeenCalledWith(`/api/ground-jobs/j1/${kind}.las`)
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe(`${kind}.las`)
    expect(await file.text()).toBe('LASF')
  })

  it('ignores network errors when deleting a job', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(deleteGroundJob('j1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/ground-jobs/j1', { method: 'DELETE' })
  })
})

it('prefixes requests with VITE_API_BASE', async () => {
  vi.stubEnv('VITE_API_BASE', 'https://api.example.com')
  vi.resetModules()
  const api = await import('./groundApi')
  fetchMock.mockResolvedValue(json({ id: 'j1', status: 'done' }))
  await api.getGroundJob('j1')
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/ground-jobs/j1')
})
