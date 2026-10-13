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

/** Prefer a real name. A coordinate string becomes the nearest neighborhood, or the city. */
export function namedArea(label: string, city: string, lat?: number | null, lng?: number | null): string {
  const text = label.trim();
  if (text && !isCoordinateLabel(text)) return text;
  if (typeof lat === 'number' && typeof lng === 'number') {
    const box = cityBox(city);
    if (box) {
      let best: { name: string; km: number } | null = null;
      for (const place of GAZETTEER) {
        if (place.city !== box.name) continue;
        const distance = km({ lat, lng }, place);
        if (distance > 3) continue;
        if (!best || distance < best.km) best = { name: place.name, km: distance };
      }
      if (best) return best.name;
    }
  }
  return city.trim() || 'Nearby';
}
