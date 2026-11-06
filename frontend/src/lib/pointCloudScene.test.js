import { describe, expect, it, vi } from 'vitest'
import * as Cesium from 'cesium'
import { addPointCloudToScene, flyToBoundingSphere } from './pointCloudScene'

const anchor = { lat: 35.6586, lon: 139.7454, height: 0 }

function fakeViewer() {
  return {
    scene: { primitives: { add: vi.fn() } },
    camera: { flyToBoundingSphere: vi.fn() },
  }
}

function cloud({ colors = null } = {}) {
  return {
    // Two opposite corners of a 10 x 20 x 4 m box
    positions: new Float32Array([100, 200, 10, 110, 220, 14]),
    colors,
    boundingBox: [
      [100, 200, 10],
      [110, 220, 14],
    ],
  }
}

describe('addPointCloudToScene', () => {
  it('adds one primitive per point to the scene', () => {
    const viewer = fakeViewer()
    const { collection } = addPointCloudToScene(viewer, cloud(), anchor)
    expect(viewer.scene.primitives.add).toHaveBeenCalledWith(collection)
    expect(collection.length).toBe(2)
  })

  it('centres the cloud on the anchor point', () => {
    const { boundingSphere } = addPointCloudToScene(fakeViewer(), cloud(), anchor)
    const anchorWorld = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.height)
    expect(Cesium.Cartesian3.distance(boundingSphere.center, anchorWorld)).toBeLessThan(1e-3)
    // Half the box diagonal: sqrt(10^2 + 20^2 + 4^2) / 2
    expect(boundingSphere.radius).toBeCloseTo(Math.sqrt(516) / 2, 3)
  })

  it('keeps ENU distances between points', () => {
    const { collection } = addPointCloudToScene(fakeViewer(), cloud(), anchor)
    const d = Cesium.Cartesian3.distance(collection.get(0).position, collection.get(1).position)
    expect(d).toBeCloseTo(Math.sqrt(516), 3)
  })

  it('uses per-point RGB colours when present', () => {
    const colors = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
    const { collection } = addPointCloudToScene(fakeViewer(), cloud({ colors }), anchor)
    expect(collection.get(0).color).toEqual(new Cesium.Color(1, 0, 0, 1))
    expect(collection.get(1).color).toEqual(new Cesium.Color(0, 1, 0, 1))
  })

  it('colours by height (blue low, red high) without RGB', () => {
    const { collection } = addPointCloudToScene(fakeViewer(), cloud(), anchor)
    const low = collection.get(0).color
    const high = collection.get(1).color
    expect(low.blue).toBeCloseTo(1)
    expect(low.red).toBeCloseTo(0)
    expect(high.red).toBeCloseTo(1)
    expect(high.blue).toBeCloseTo(0)
  })
})

it('flyToBoundingSphere frames the sphere from an oblique angle', () => {
  const viewer = fakeViewer()
  const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 10)
  flyToBoundingSphere(viewer, sphere)
  const [target, { offset }] = viewer.camera.flyToBoundingSphere.mock.calls[0]
  expect(target).toBe(sphere)
  expect(offset.range).toBe(25)
  expect(offset.pitch).toBeCloseTo(Cesium.Math.toRadians(-30))
})

describe('addPointCloudToScene with a CRS', () => {
  // A stand-in CRS whose X/Y already are lon/lat degrees.
  const lonLatCrs = { toLonLat: ([x, y]) => [x, y], zScale: 0.5 }
  const georef = () => ({
    positions: new Float64Array([139.7, 35.6, 10, 139.8, 35.7, 30]),
    colors: null,
    boundingBox: [
      [139.7, 35.6, 10],
      [139.8, 35.7, 30],
    ],
  })

  it('puts each point at its converted lon/lat with Z scaled to metres', () => {
    const { collection } = addPointCloudToScene(fakeViewer(), georef(), anchor, lonLatCrs)
    const p0 = Cesium.Cartographic.fromCartesian(collection.get(0).position)
    expect(Cesium.Math.toDegrees(p0.longitude)).toBeCloseTo(139.7, 9)
    expect(Cesium.Math.toDegrees(p0.latitude)).toBeCloseTo(35.6, 9)
    expect(p0.height).toBeCloseTo(5, 6)
  })

  it('ignores the anchor', () => {
    const a = addPointCloudToScene(fakeViewer(), georef(), anchor, lonLatCrs)
    const b = addPointCloudToScene(fakeViewer(), georef(), { lat: 0, lon: 0, height: 0 }, lonLatCrs)
    expect(a.collection.get(1).position).toEqual(b.collection.get(1).position)
  })

  it('bounds the converted cloud', () => {
    const { boundingSphere } = addPointCloudToScene(fakeViewer(), georef(), anchor, lonLatCrs)
    const centre = Cesium.Cartographic.fromCartesian(boundingSphere.center)
    expect(Cesium.Math.toDegrees(centre.longitude)).toBeCloseTo(139.75, 2)
    expect(Cesium.Math.toDegrees(centre.latitude)).toBeCloseTo(35.65, 2)
  })

  it('surfaces conversion errors without adding anything to the scene', () => {
    const viewer = fakeViewer()
    const broken = { toLonLat: () => { throw new Error('outside the valid area') }, zScale: 1 }
    expect(() => addPointCloudToScene(viewer, georef(), anchor, broken)).toThrow(/outside/)
    expect(viewer.scene.primitives.add).not.toHaveBeenCalled()
  })
})
