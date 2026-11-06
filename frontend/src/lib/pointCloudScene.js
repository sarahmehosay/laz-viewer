import * as Cesium from 'cesium'

/**
 * Places a parsed LAS/LAZ point cloud into a Cesium scene.
 *
 * With a CRS (see crs.js) every point is projected to WGS84 lon/lat and put
 * at its real position; Z is used as the height above the ellipsoid.
 *
 * Without one, the file's local X/Y/Z are treated as East/North/Up offsets
 * from a user-chosen anchor point on the globe (a local tangent plane). This
 * keeps the cloud's shape and scale correct; only its real-world location is
 * an approximation the user controls.
 */
export function addPointCloudToScene(viewer, cloud, anchor, crs = null) {
  const { positions, colors, boundingBox } = cloud
  const [minX, minY, minZ] = boundingBox[0]
  const [maxX, maxY, maxZ] = boundingBox[1]
  const zRange = Math.max(1e-6, maxZ - minZ)
  const toWorld = crs ? crsPlacement(crs) : anchorPlacement(anchor, boundingBox)

  const collection = new Cesium.PointPrimitiveCollection()
  const pointCount = positions.length / 3

  for (let i = 0; i < pointCount; i++) {
    const world = toWorld(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])

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
      for (const z of [minZ, maxZ]) corners.push(toWorld(x, y, z))
    }
  }
  const boundingSphere = Cesium.BoundingSphere.fromPoints(corners)

  return { collection, boundingSphere }
}

function crsPlacement(crs) {
  return (x, y, z) => {
    const [lon, lat] = crs.toLonLat([x, y])
    return Cesium.Cartesian3.fromDegrees(lon, lat, z * crs.zScale)
  }
}

function anchorPlacement(anchor, [[minX, minY, minZ], [maxX, maxY, maxZ]]) {
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.height)
  )
  const local = new Cesium.Cartesian3()
  return (x, y, z) => {
    local.x = x - centerX
    local.y = y - centerY
    local.z = z - centerZ
    return Cesium.Matrix4.multiplyByPoint(enuMatrix, local, new Cesium.Cartesian3())
  }
}

export function flyToBoundingSphere(viewer, boundingSphere) {
  viewer.camera.flyToBoundingSphere(boundingSphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), boundingSphere.radius * 2.5),
  })
}
