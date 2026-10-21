/**
 * Client-side names for heatmap pins.
 * The same boxes the API uses, so a coordinate label never reaches the screen.
 */

export interface CityBox {
  name: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

const CITY_BOXES: readonly CityBox[] = [
  { name: 'Tokyo', south: 35.53, north: 35.82, west: 139.55, east: 139.93 },
  { name: 'Los Angeles', south: 33.7, north: 34.35, west: -118.7, east: -118.15 },
  { name: 'New York', south: 40.49, north: 40.92, west: -74.26, east: -73.7 },
  { name: 'San Francisco', south: 37.7, north: 37.84, west: -122.52, east: -122.35 },
  { name: 'Munich', south: 48.06, north: 48.25, west: 11.36, east: 11.72 },
  { name: 'Bangkok', south: 13.49, north: 13.96, west: 100.32, east: 100.95 },
  { name: 'Seoul', south: 37.42, north: 37.7, west: 126.79, east: 127.18 },
  { name: 'Osaka', south: 34.55, north: 34.78, west: 135.4, east: 135.62 },
  { name: 'Lisbon', south: 38.69, north: 38.8, west: -9.23, east: -9.09 },
];

const GAZETTEER: readonly { name: string; lat: number; lng: number; city: string }[] = [
  { name: 'Shimokitazawa', lat: 35.6614, lng: 139.6676, city: 'Tokyo' },
  { name: 'Koenji', lat: 35.7056, lng: 139.6496, city: 'Tokyo' },
  { name: 'Shibuya', lat: 35.6595, lng: 139.7004, city: 'Tokyo' },
  { name: 'Shinjuku', lat: 35.6938, lng: 139.7034, city: 'Tokyo' },
  { name: 'Harajuku', lat: 35.6702, lng: 139.7027, city: 'Tokyo' },
  { name: 'Omotesando', lat: 35.6654, lng: 139.7121, city: 'Tokyo' },
  { name: 'Nakameguro', lat: 35.6442, lng: 139.6989, city: 'Tokyo' },
  { name: 'Daikanyama', lat: 35.6495, lng: 139.7031, city: 'Tokyo' },
  { name: 'Ebisu', lat: 35.6467, lng: 139.7101, city: 'Tokyo' },
  { name: 'Meguro', lat: 35.6339, lng: 139.7158, city: 'Tokyo' },
  { name: 'Kichijoji', lat: 35.7032, lng: 139.5797, city: 'Tokyo' },
  { name: 'Asakusa', lat: 35.7148, lng: 139.7967, city: 'Tokyo' },
  { name: 'Ueno', lat: 35.7138, lng: 139.777, city: 'Tokyo' },
  { name: 'Roppongi', lat: 35.6628, lng: 139.7314, city: 'Tokyo' },
  { name: 'Ginza', lat: 35.6717, lng: 139.765, city: 'Tokyo' },
  { name: 'Akihabara', lat: 35.6984, lng: 139.7731, city: 'Tokyo' },
  { name: 'Ikebukuro', lat: 35.7295, lng: 139.7109, city: 'Tokyo' },
  { name: 'Sangenjaya', lat: 35.6434, lng: 139.6698, city: 'Tokyo' },
  { name: 'Silver Lake', lat: 34.0869, lng: -118.2702, city: 'Los Angeles' },
  { name: 'Echo Park', lat: 34.0782, lng: -118.2606, city: 'Los Angeles' },
  { name: 'SoHo', lat: 40.7233, lng: -74.003, city: 'New York' },
  { name: 'Lower East Side', lat: 40.715, lng: -73.9843, city: 'New York' },
  { name: 'Williamsburg', lat: 40.7081, lng: -73.9571, city: 'New York' },
  { name: 'Chelsea', lat: 40.7465, lng: -74.0014, city: 'New York' },
  { name: 'Thonglor', lat: 13.7308, lng: 100.582, city: 'Bangkok' },
  { name: 'Ari', lat: 13.7796, lng: 100.5446, city: 'Bangkok' },
  { name: 'Silom', lat: 13.7262, lng: 100.5231, city: 'Bangkok' },
  { name: 'Hongdae', lat: 37.5563, lng: 126.9236, city: 'Seoul' },
  { name: 'Seongsu', lat: 37.5446, lng: 127.0559, city: 'Seoul' },
  { name: 'Itaewon', lat: 37.5345, lng: 126.9946, city: 'Seoul' },
  { name: 'Alfama', lat: 38.7126, lng: -9.1302, city: 'Lisbon' },
  { name: 'Bairro Alto', lat: 38.7122, lng: -9.1444, city: 'Lisbon' },
  { name: 'Príncipe Real', lat: 38.7166, lng: -9.1487, city: 'Lisbon' },
  { name: 'Ari', lat: 13.7796, lng: 100.5446, city: 'Bangkok' },
  { name: 'Ratchada', lat: 13.7660, lng: 100.5690, city: 'Bangkok' },
  { name: 'Ladprao', lat: 13.8160, lng: 100.5610, city: 'Bangkok' },
  { name: 'Bang Kapi', lat: 13.7650, lng: 100.6470, city: 'Bangkok' },
  { name: 'Khan Na Yao', lat: 13.8270, lng: 100.6750, city: 'Bangkok' },
  { name: 'Ram Inthra', lat: 13.8660, lng: 100.6500, city: 'Bangkok' },
  { name: 'Min Buri', lat: 13.8140, lng: 100.7480, city: 'Bangkok' },
  { name: 'Lat Krabang', lat: 13.7220, lng: 100.7590, city: 'Bangkok' },
  { name: 'Prawet', lat: 13.7170, lng: 100.6900, city: 'Bangkok' },
  { name: 'On Nut', lat: 13.7050, lng: 100.6010, city: 'Bangkok' },
  { name: 'Bang Na', lat: 13.6680, lng: 100.6050, city: 'Bangkok' },
  { name: 'Thonglor', lat: 13.7320, lng: 100.5830, city: 'Bangkok' },
  { name: 'Silom', lat: 13.7250, lng: 100.5300, city: 'Bangkok' },
  { name: 'Don Mueang', lat: 13.9130, lng: 100.6040, city: 'Bangkok' },
  { name: 'Thonburi', lat: 13.7200, lng: 100.4850, city: 'Bangkok' },
  { name: 'Umeda', lat: 34.7025, lng: 135.4959, city: 'Osaka' },
  { name: 'Namba', lat: 34.6659, lng: 135.5013, city: 'Osaka' },
  { name: 'Shinsaibashi', lat: 34.6748, lng: 135.5013, city: 'Osaka' },
  { name: 'Tennoji', lat: 34.6466, lng: 135.5133, city: 'Osaka' },
  { name: 'Horie', lat: 34.6735, lng: 135.4930, city: 'Osaka' },
  { name: 'Nakazakicho', lat: 34.7070, lng: 135.5050, city: 'Osaka' },
];

const COORDINATE_LABEL = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+|^area\s+-?\d/i;

export function cityBox(location: string): CityBox | null {
  const needle = location.trim().toLowerCase();
  if (!needle) return null;
  return CITY_BOXES.find((box) => needle.includes(box.name.toLowerCase())) ?? null;
}

export function insideCity(lat: number, lng: number, location: string): boolean {
  const box = cityBox(location);
  if (!box) return true;
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

export function isCoordinateLabel(label: string): boolean {
  return COORDINATE_LABEL.test(label.trim());
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const south =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(south)));
}

function nearestDistrict(lat: number, lng: number, city: string, maxKm = 8): string | null {
  const box = cityBox(city);
  if (!box) return null;
  let best: { name: string; km: number } | null = null;
  for (const place of GAZETTEER) {
    if (place.city !== box.name) continue;
    const distance = km({ lat, lng }, place);
    if (distance > maxKm) continue;
    if (!best || distance < best.km) best = { name: place.name, km: distance };
  }
  return best?.name ?? null;
}

/** Snap a pin to the nearest well-known district. Coordinates and block names stay off the map. */
export function namedArea(label: string, city: string, lat?: number | null, lng?: number | null): string {
  if (typeof lat === 'number' && typeof lng === 'number') {
    const nearest = nearestDistrict(lat, lng, city, 8);
    if (nearest) return nearest;
  }
  const text = label.trim();
  if (text && !isCoordinateLabel(text) && !/ch[oō]me|丁目/i.test(text)) return text;
  return city.trim() || 'Nearby';
}

/** One pin per district. The stronger weight keeps the coordinate. */
export function groupDistricts<T extends { label: string; weight: number }>(areas: readonly T[]): T[] {
  const grouped = new Map<string, T>();
  for (const area of areas) {
    const key = area.label.trim().toLowerCase();
    const current = grouped.get(key);
    if (!current || area.weight > current.weight) grouped.set(key, area);
  }
  return [...grouped.values()];
}

export function playbackDistricts(city: string): Array<{ label: string; lat: number; lng: number; weight: number }> {
  if (city.trim().toLowerCase() === 'tokyo') {
    return [
      { label: 'Shimokitazawa', lat: 35.6614, lng: 139.6676, weight: 0.84 },
      { label: 'Koenji', lat: 35.7056, lng: 139.6496, weight: 0.71 },
      { label: 'Shibuya', lat: 35.6595, lng: 139.7004, weight: 0.66 },
    ];
  }
  const box = cityBox(city);
  const rows = GAZETTEER.filter((place) => place.city === box?.name).slice(0, 3);
  return rows.map((place, index) => ({ label: place.name, lat: place.lat, lng: place.lng, weight: [0.7, 0.58, 0.46][index] ?? 0.4 }));
}
