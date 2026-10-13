/**
 * City boxes and a small gazetteer for neighborhood labels.
 * Known cities drop heatmap cells that fall outside the box.
 * Unknown cities keep every cell, and never label one with raw coordinates.
 */

export interface CityBox {
  name: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

export const CITY_BOXES: readonly CityBox[] = [
  { name: 'Tokyo', south: 35.53, north: 35.82, west: 139.55, east: 139.93 },
  { name: 'Los Angeles', south: 33.7, north: 34.35, west: -118.7, east: -118.15 },
  { name: 'New York', south: 40.49, north: 40.92, west: -74.26, east: -73.7 },
  { name: 'San Francisco', south: 37.7, north: 37.84, west: -122.52, east: -122.35 },
  { name: 'Munich', south: 48.06, north: 48.25, west: 11.36, east: 11.72 },
  { name: 'Bangkok', south: 13.49, north: 13.96, west: 100.32, east: 100.95 },
  { name: 'Seoul', south: 37.42, north: 37.7, west: 126.79, east: 127.18 },
  { name: 'Lisbon', south: 38.69, north: 38.8, west: -9.23, east: -9.09 },
];

interface GazetteerPlace {
  name: string;
  lat: number;
  lng: number;
  city: string;
}

const GAZETTEER: readonly GazetteerPlace[] = [
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
];

const COORDINATE_LABEL = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+|^area\s+-?\d/i;
const BLOCK_LABEL = /ch[oō]me|丁目|\bbldg\b|\bbuilding\b|\btower\b/i;

export function cityBox(location: string): CityBox | null {
  const needle = location.trim().toLowerCase();
  if (!needle) return null;
  return CITY_BOXES.find((box) => needle.includes(box.name.toLowerCase())) ?? null;
}

export function insideCity(lat: number, lng: number, box: CityBox | null): boolean {
  if (!box) return true;
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

export function isCoordinateLabel(label: string): boolean {
  return COORDINATE_LABEL.test(label.trim());
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const south =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(south)));
}

function mode(values: readonly string[]): string | undefined {
  if (!values.length) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function nearestNeighborhood(lat: number, lng: number, location: string, maxKm = 8): string | null {
  const box = cityBox(location);
  if (!box) return null;
  let best: { name: string; km: number } | null = null;
  for (const place of GAZETTEER) {
    if (place.city !== box.name) continue;
    const distance = haversineKm({ lat, lng }, place);
    if (distance > maxKm) continue;
    if (!best || distance < best.km) best = { name: place.name, km: distance };
  }
  return best?.name ?? null;
}

/** A readable area name. Coordinates are never returned. */
export function areaLabel(input: {
  lat: number;
  lng: number;
  city: string;
  neighborhoods: readonly string[];
  nearbyNames: readonly string[];
}): string {
  const known = nearestNeighborhood(input.lat, input.lng, input.city, 8);
  if (known) return known;
  const neighborhoods = input.neighborhoods
    .map((label) => label.trim())
    .filter((label) => label && !isCoordinateLabel(label) && !BLOCK_LABEL.test(label));
  const named = mode(neighborhoods);
  if (named) return named;
  const place = input.nearbyNames
    .map((label) => label.trim())
    .find((label) => label && !isCoordinateLabel(label) && !BLOCK_LABEL.test(label));
  if (place) return `Near ${place}`;
  const city = input.city.trim();
  return city || 'Nearby';
}
