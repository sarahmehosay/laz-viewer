const BASE = import.meta.env.VITE_API_BASE || ''

export const DEFAULT_GROUND_PARAMS = {
  cell_size: 1.0,
  max_window: 30,
  slope: 0.15,
  initial_threshold: 0.3,
  max_threshold: 3.0,
  point_threshold: 0.3,
}

async function check(res) {
  if (res.ok) return res
  let detail = res.statusText
  try {
    const body = await res.json()
    detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
  } catch {}
  throw new Error(`Backend error (${res.status}): ${detail}`)
}

export async function startGroundJob(file, params) {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(params)) form.append(k, String(v))
  const res = await check(await fetch(`${BASE}/api/ground-jobs`, { method: 'POST', body: form }))
  return (await res.json()).id
}

export async function getGroundJob(id) {
  return (await check(await fetch(`${BASE}/api/ground-jobs/${id}`))).json()
}

export async function fetchGroundResult(id, kind = 'ground') {
  const blob = await (await check(await fetch(`${BASE}/api/ground-jobs/${id}/${kind}.las`))).blob()
  return new File([blob], `${kind}.las`, { type: 'application/octet-stream' })
}

export async function deleteGroundJob(id) {
  await fetch(`${BASE}/api/ground-jobs/${id}`, { method: 'DELETE' }).catch(() => {})
}
