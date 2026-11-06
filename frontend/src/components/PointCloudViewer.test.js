import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PointCloudViewer from './PointCloudViewer.vue'
import * as las from '../lib/las'
import * as scene from '../lib/pointCloudScene'

// The real Cesium Viewer needs WebGL; placement logic is what's under test here.
vi.mock('cesium', () => ({
  Viewer: vi.fn(function Viewer() {
    this.scene = {
      primitives: { add: vi.fn(), remove: vi.fn() },
      globe: {},
      skyBox: {},
      skyAtmosphere: {},
      sun: {},
      moon: {},
      fog: {},
    }
    this.destroy = vi.fn()
  }),
  Color: { fromCssColorString: (c) => c },
}))
vi.mock('../lib/las', async (importOriginal) => ({
  ...(await importOriginal()),
  peekLasHeader: vi.fn(),
  loadLasPointCloud: vi.fn(),
  readLasCrs: vi.fn(),
}))
vi.mock('../lib/pointCloudScene', () => ({
  addPointCloudToScene: vi.fn(() => ({ collection: {}, boundingSphere: {} })),
  flyToBoundingSphere: vi.fn(),
}))

const HEADER = { pointsCount: 3 }
const CLOUD = { renderedCount: 3, skip: 1, colors: null, blankColor: null }

async function loadFile(wrapper, name = 'scan.laz') {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['LASF'], name)], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const lastCrs = () => scene.addPointCloudToScene.mock.calls.at(-1)[3]
const apply = (w) => w.findAll('button').find((b) => b.text() === 'Apply placement').trigger('click')

beforeEach(() => {
  vi.clearAllMocks()
  las.peekLasHeader.mockResolvedValue(HEADER)
  las.loadLasPointCloud.mockResolvedValue(CLOUD)
  las.readLasCrs.mockResolvedValue(null)
})

function mountViewer() {
  return mount(PointCloudViewer, { global: { stubs: { GroundExtractionPanel: true } } })
}

describe('PointCloudViewer placement', () => {
  it("places the cloud with the file's EPSG code", async () => {
    las.readLasCrs.mockResolvedValue({ epsg: 6675, wkt: null, zUnitsToMetres: 1, source: 'geotiff' })
    const w = mountViewer()
    await loadFile(w)

    expect(lastCrs().label).toBe('EPSG:6675 · JGD2011 / Japan Plane Rectangular CS VII')
    expect(w.text()).toContain('Placed by EPSG:6675 · JGD2011 / Japan Plane Rectangular CS VII')
    expect(w.find('input[value="file"]').element.disabled).toBe(false)
  })

  it('falls back to the anchor when the file has no CRS', async () => {
    const w = mountViewer()
    await loadFile(w)

    expect(lastCrs()).toBeNull()
    expect(w.text()).toContain('Placed at the manual anchor')
    expect(w.text()).toContain('None in this file')
    expect(w.find('input[value="file"]').element.disabled).toBe(true)
  })

  it('re-places the cloud with an EPSG code typed by the user', async () => {
    las.readLasCrs.mockResolvedValue({ epsg: 6681, wkt: null, zUnitsToMetres: 1, source: 'geotiff' })
    const w = mountViewer()
    await loadFile(w)
    expect(lastCrs().code).toBe(6681)

    await w.find('input[value="epsg"]').setValue()
    await w.find('input[placeholder="e.g. 6675"]').setValue('6675')
    await apply(w)
    await flushPromises()

    expect(lastCrs().code).toBe(6675)
    expect(w.text()).toContain('Placed by EPSG:6675')
  })

  it('asks for a code when EPSG mode has none', async () => {
    const w = mountViewer()
    await loadFile(w)
    await w.find('input[value="epsg"]').setValue()
    await apply(w)
    await flushPromises()

    expect(lastCrs()).toBeNull()
    expect(w.text()).toContain('Enter an EPSG code')
  })

  it('uses the anchor when chosen, even if the file has a CRS', async () => {
    las.readLasCrs.mockResolvedValue({ epsg: 6675, wkt: null, zUnitsToMetres: 1, source: 'geotiff' })
    const w = mountViewer()
    await loadFile(w)
    await w.find('input[value="anchor"]').setValue()
    await apply(w)
    await flushPromises()

    expect(lastCrs()).toBeNull()
    expect(scene.addPointCloudToScene.mock.calls.at(-1)[2]).toEqual({ lat: 35.6586, lon: 139.7454, height: 0 })
  })

  it('falls back to the anchor with a warning when points do not fit the CRS', async () => {
    las.readLasCrs.mockResolvedValue({ epsg: 32760, wkt: null, zUnitsToMetres: 1, source: 'geotiff' })
    scene.addPointCloudToScene
      .mockImplementationOnce(() => {
        throw new Error('Coordinates (1, 2) are outside the valid area of WGS 84 / UTM zone 60S.')
      })
    const w = mountViewer()
    await loadFile(w)

    expect(scene.addPointCloudToScene).toHaveBeenCalledTimes(2)
    expect(lastCrs()).toBeUndefined() // second call: anchor placement
    expect(w.text()).toContain('outside the valid area')
    expect(w.text()).toContain('Placed at the manual anchor')
  })

  it("goes back to the file's CRS when a new file is loaded", async () => {
    las.readLasCrs.mockResolvedValue({ epsg: 6675, wkt: null, zUnitsToMetres: 1, source: 'geotiff' })
    const w = mountViewer()
    await loadFile(w)
    await w.find('input[value="anchor"]').setValue()
    await loadFile(w, 'other.laz')

    expect(lastCrs().code).toBe(6675)
  })
})
