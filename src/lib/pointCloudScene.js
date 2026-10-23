import * as Cesium from 'cesium'

/**
 * Places a parsed LAS/LAZ point cloud into a Cesium scene.
 *
 * LAS coordinates carry no CRS metadata we can rely on, so instead of
 * guessing a projection we treat the file's local X/Y/Z as East/North/Up
 * offsets from a user-chosen anchor point on the globe (a local tangent
 * plane). This keeps the cloud's shape and scale correct; only its
 * real-world location is an approximation the user controls.
 */
export function addPointCloudToScene(viewer, cloud, anchor) {
  const { positions, colors, boundingBox } = cloud
  const [minX, minY, minZ] = boundingBox[0]
  const [maxX, maxY, maxZ] = boundingBox[1]
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  const zRange = Math.max(1e-6, maxZ - minZ)

  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.height)
  )

  const collection = new Cesium.PointPrimitiveCollection()
  const pointCount = positions.length / 3
  const local = new Cesium.Cartesian3()

  for (let i = 0; i < pointCount; i++) {
    local.x = positions[i * 3] - centerX
    local.y = positions[i * 3 + 1] - centerY
    local.z = positions[i * 3 + 2] - centerZ
    const world = Cesium.Matrix4.multiplyByPoint(enuMatrix, local, new Cesium.Cartesian3())

    let color
    if (colors) {
      color = new Cesium.Color(colors[i * 4] / 255, colors[i * 4 + 1] / 255, colors[i * 4 + 2] / 255, 1)
    } else {
      const t = (positions[i * 3 + 2] - minZ) / zRange
      color = Cesium.Color.fromHsl(0.66 - 0.66 * t, 1.0, 0.5)
    }

    collection.add({ position: world, color, pixelSize: 2 })
  }

  viewer.scene.primitives.add(collection)

  const corners = []
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) {
        local.x = x - centerX
        local.y = y - centerY
        local.z = z - centerZ
        corners.push(Cesium.Matrix4.multiplyByPoint(enuMatrix, local, new Cesium.Cartesian3()))
      }
    }
  }
  const boundingSphere = Cesium.BoundingSphere.fromPoints(corners)

  return { collection, boundingSphere }
}

export function flyToBoundingSphere(viewer, boundingSphere) {
  viewer.camera.flyToBoundingSphere(boundingSphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), boundingSphere.radius * 2.5),
  })
}
