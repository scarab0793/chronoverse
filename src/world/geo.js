// Local metric coordinates <-> WGS84. The playable area is a local tangent
// plane around the East Anglia test region; -Z is north, +X is east.
// Distances for jump range checks are geodesic (haversine), as required.

export const ORIGIN = Object.freeze({ lat: 52.62, lon: 1.73 });
const EARTH_RADIUS_KM = 6371.0088;
const M_PER_DEG_LAT = 111320;
const rad = d => (d * Math.PI) / 180;

export function localToLatLon(x, z) {
  return {
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / (M_PER_DEG_LAT * Math.cos(rad(ORIGIN.lat))),
  };
}

export function latLonToLocal(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LAT * Math.cos(rad(ORIGIN.lat)),
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Geodesic distance in km between two local positions. */
export function geodesicKm(p, q) {
  return haversineKm(localToLatLon(p.x, p.z), localToLatLon(q.x, q.z));
}
