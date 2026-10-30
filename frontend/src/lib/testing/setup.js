import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The laz-rs WASM loader fetches its .wasm via `new URL(..., import.meta.url)`.
// Browsers (and the Vite build) serve that over HTTP; in Node it is a file: URL,
// which fetch() cannot load, so read those from disk instead.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : typeof input === 'string' && input.startsWith('file:') ? new URL(input) : null
  if (url?.protocol === 'file:') {
    const type = url.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
    return new Response(await readFile(fileURLToPath(url)), { headers: { 'Content-Type': type } })
  }
  return realFetch(input, init)
}
