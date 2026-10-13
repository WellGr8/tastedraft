/**
 * Interactive district map (MapLibre GL + CARTO/OSM raster tiles).
 * Open split/map.html. Heat layers come from POST /api/map.
 */

export const CITY_NAMES = ['Los Angeles', 'New York', 'San Francisco', 'Austin', 'Miami', 'Chicago', 'Seattle', 'Bangkok'];

/** Same neighbourhood centres as server/src/providers/qloo/heatmap.ts. */
const PLACES = {
  'Los Angeles': {
    center: { lat: 34.0522, lng: -118.2437 },
    fits: [['Silver Lake', 34.0869, -118.2702], ['Echo Park', 34.0782, -118.2606]],
    friction: [['Beverly Hills', 34.0736, -118.4004], ['West Hollywood', 34.09, -118.3617]],
  },
  'New York': {
    center: { lat: 40.7128, lng: -74.006 },
    fits: [['Lower East Side', 40.715, -73.9843], ['Williamsburg', 40.7081, -73.9571]],
    friction: [['Upper East Side', 40.7736, -73.9566], ['Tribeca', 40.7163, -74.0086]],
  },
  'San Francisco': {
    center: { lat: 37.7749, lng: -122.4194 },
    fits: [['Mission', 37.7599, -122.4148], ['Hayes Valley', 37.7763, -122.4242]],
    friction: [['Pacific Heights', 37.7925, -122.4382], ['Union Square', 37.788, -122.4074]],
  },
  Austin: {
    center: { lat: 30.2672, lng: -97.7431 },
    fits: [['East Austin', 30.2628, -97.7145], ['South Congress', 30.25, -97.749]],
    friction: [['Westlake', 30.297, -97.812], ['The Domain', 30.4021, -97.7255]],
  },
  Miami: {
    center: { lat: 25.7617, lng: -80.1918 },
    fits: [['Wynwood', 25.801, -80.1994], ['Little Haiti', 25.8246, -80.1918]],
    friction: [['South Beach', 25.7826, -80.1341], ['Brickell', 25.7617, -80.1918]],
  },
  Chicago: {
    center: { lat: 41.8781, lng: -87.6298 },
    fits: [['Logan Square', 41.9231, -87.7093], ['Wicker Park', 41.9088, -87.6796]],
    friction: [['Gold Coast', 41.9058, -87.6273], ['River North', 41.8924, -87.6341]],
  },
  Bangkok: {
    center: { lat: 13.7563, lng: 100.5018 },
    fits: [['Yaowarat', 13.741, 100.51], ['Talad Neon', 13.77, 100.569]],
    friction: [['Thonglor', 13.724, 100.578], ['Siam', 13.746, 100.535]],
  },
  Seattle: {
    center: { lat: 47.6062, lng: -122.3321 },
    fits: [['Capitol Hill', 47.6253, -122.3222], ['Fremont', 47.651, -122.35]],
    friction: [['Medina', 47.6205, -122.227], ['Bellevue', 47.6101, -122.2015]],
  },
};

const RASTER_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

const EMPTY = { type: 'FeatureCollection', features: [] };

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function thumbnail(name) {
  const initials = String(name).split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  let hue = 0;
  const text = String(name);
  for (let i = 0; i < text.length; i += 1) hue = (hue * 33 + text.charCodeAt(i)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},42%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 36) % 360},38%,58%)"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><circle cx="62" cy="18" r="8" fill="rgba(255,255,255,.35)"/><path d="M0 58 L22 40 L38 52 L56 34 L80 54 L80 80 L0 80 Z" fill="rgba(255,255,255,.28)"/><text x="40" y="44" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="700" fill="white">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function cardsFor(city) {
  const table = PLACES[city] || PLACES['Los Angeles'];
  const rows = [];
  for (const [name, lat, lng] of table.fits) rows.push({ name, lat, lng, role: 'fits', chosen: true });
  for (const [name, lat, lng] of table.friction) rows.push({ name, lat, lng, role: 'friction', chosen: false });
  return rows.map((row) => ({
    id: `loc-${slug(row.name)}`,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    role: row.role,
    chosen: row.chosen,
    image: thumbnail(row.name),
  }));
}

export function chosenPins(cards) {
  return (cards || []).filter((card) => card.chosen).map((card) => ({
    id: card.id,
    name: card.name,
    lat: card.lat,
    lng: card.lng,
    image: card.image || thumbnail(card.name),
  }));
}

export function selectLayers(payload, view) {
  const group = payload?.[view.district] || {};
  const layers = [];
  if (view.version !== 'v2' && group.v1) layers.push({ version: 'v1', layer: group.v1 });
  if (view.version !== 'v1' && group.v2) layers.push({ version: 'v2', layer: group.v2 });
  return layers;
}

export function toFeatureCollection(layer, draw, version) {
  const rows = !layer ? [] : layer.kind === 'heatmap' ? layer.cells : layer.pins;
  return {
    type: 'FeatureCollection',
    features: (rows || []).map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      properties: {
        id: row.id,
        name: row.label || row.name || row.id,
        weight: typeof row.weight === 'number' ? row.weight : 0.6,
        draw,
        version,
      },
    })),
  };
}

export function boundsFor(center, layers) {
  const points = [[center.lng, center.lat]];
  for (const layer of layers) {
    const rows = layer?.kind === 'pins' ? layer.pins : layer?.cells || [];
    for (const row of rows) points.push([row.lng, row.lat]);
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const latPad = Math.max((north - south) * 0.35, 0.03);
  const lngPad = Math.max((east - west) * 0.35, 0.03);
  return [[west - lngPad, south - latPad], [east + lngPad, north + latPad]];
}

function layerPoints(layer) {
  if (!layer) return [];
  if (layer.kind === 'heatmap') {
    return layer.cells.map((cell) => ({ name: cell.label || cell.id, weight: cell.weight ?? null, lat: cell.lat, lng: cell.lng }));
  }
  return (layer.pins || []).map((pin) => ({ name: pin.name, weight: null, lat: pin.lat, lng: pin.lng }));
}

export function compareRows(payload, district) {
  const group = payload?.[district] || {};
  const v1 = layerPoints(group.v1);
  const v2 = layerPoints(group.v2);
  const names = [];
  const seen = new Set();
  for (const row of v1.concat(v2)) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    names.push(row.name);
  }
  return names.map((name) => {
    const left = v1.find((row) => row.name === name);
    const right = v2.find((row) => row.name === name);
    const point = left || right;
    return { name, v1: left?.weight ?? null, v2: right?.weight ?? null, lat: point.lat, lng: point.lng };
  });
}

function heatColors(district, version) {
  if (district === 'friction') {
    return version === 'v2'
      ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(184,137,43,0)', 0.45, 'rgba(184,137,43,0.55)', 1, 'rgba(160,43,40,0.9)']
      : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(160,43,40,0)', 0.4, 'rgba(160,43,40,0.5)', 1, 'rgba(120,24,22,0.92)'];
  }
  return version === 'v2'
    ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(12,95,56,0)', 0.4, 'rgba(12,95,56,0.5)', 1, 'rgba(12,95,56,0.9)']
    : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(23,24,43,0)', 0.4, 'rgba(47,63,214,0.55)', 1, 'rgba(23,24,43,0.92)'];
}

function circleColor(district, version) {
  if (district === 'friction') return version === 'v2' ? '#B8892B' : '#A02B28';
  return version === 'v2' ? '#0C5F38' : '#17182B';
}

function formatWeight(value) {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

export function apiBase() {
  const marked = globalThis.__TASTEDRAFT_API_BASE__;
  if (marked) return String(marked).replace(/\/$/, '');
  if (typeof location === 'undefined') return 'http://127.0.0.1:8787';
  if (location.protocol === 'file:') return 'http://127.0.0.1:8787';
  if (location.port === '8787') return location.origin;
  return 'http://127.0.0.1:8787';
}

export function mountMap(container, options) {
  const maplibregl = options.maplibregl || globalThis.maplibregl;
  if (!maplibregl) throw new Error('MapLibre GL is not loaded');
  const map = new maplibregl.Map({
    container,
    style: RASTER_STYLE,
    center: [options.payload.center.lng, options.payload.center.lat],
    zoom: 12,
    attributionControl: true,
    maxPitch: 0,
  });
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const markers = [];
  let current = {
    payload: options.payload,
    view: options.view,
    cards: options.cards || [],
  };
  let ready = false;

  function clearMarkers() {
    while (markers.length) markers.pop().remove();
  }

  function addMarker(element, lng, lat) {
    const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
    markers.push(marker);
  }

  function render() {
    if (!ready) return;
    const { payload, view, cards } = current;
    const selected = selectLayers(payload, view);
    const byVersion = { v1: null, v2: null };
    for (const item of selected) byVersion[item.version] = item.layer;
    for (const version of ['v1', 'v2']) {
      const layer = byVersion[version];
      const draw = layer?.kind === 'pins' ? 'pin' : 'heat';
      map.getSource(`layer-${version}`).setData(layer ? toFeatureCollection(layer, draw, version) : EMPTY);
      const shown = Boolean(layer);
      map.setLayoutProperty(`heat-${version}`, 'visibility', shown && draw === 'heat' ? 'visible' : 'none');
      map.setLayoutProperty(`pin-${version}`, 'visibility', shown && draw === 'pin' ? 'visible' : 'none');
      if (shown && draw === 'heat') {
        map.setPaintProperty(`heat-${version}`, 'heatmap-color', heatColors(view.district, version));
        map.setPaintProperty(`heat-${version}`, 'heatmap-opacity', view.version === 'both' && version === 'v2' ? 0.62 : 0.85);
      }
      if (shown && draw === 'pin') {
        map.setPaintProperty(`pin-${version}`, 'circle-color', circleColor(view.district, version));
      }
    }
    clearMarkers();
    const chosen = chosenPins(cards);
    const chosenNames = new Set(chosen.map((pin) => pin.name));
    const rows = compareRows(payload, view.district);
    const weightText = (row) => (view.version === 'both' ? `${formatWeight(row.v1)} → ${formatWeight(row.v2)}` : formatWeight(view.version === 'v2' ? row.v2 : row.v1));
    for (const row of rows) {
      if (chosenNames.has(row.name)) continue;
      const el = document.createElement('div');
      el.className = 'td-heat-label';
      el.textContent = `${row.name} · ${weightText(row)}`;
      addMarker(el, row.lng, row.lat);
    }
    for (const pin of chosen) {
      const row = rows.find((item) => item.name === pin.name);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'td-pin';
      el.setAttribute('aria-label', pin.name);
      const img = document.createElement('img');
      img.alt = '';
      img.src = pin.image;
      const caption = document.createElement('span');
      caption.textContent = row ? `${pin.name} · ${weightText(row)}` : pin.name;
      el.append(img, caption);
      addMarker(el, pin.lng, pin.lat);
    }
    const layers = selected.map((item) => item.layer).concat([{ kind: 'pins', pins: chosen }]);
    map.fitBounds(boundsFor(payload.center, layers), { padding: 64, maxZoom: 13, animate: false });
    map.resize();
  }

  map.on('load', () => {
    for (const version of ['v1', 'v2']) {
      map.addSource(`layer-${version}`, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `heat-${version}`,
        type: 'heatmap',
        source: `layer-${version}`,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 1.15,
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 28, 13, 54],
          'heatmap-opacity': 0.85,
          'heatmap-color': heatColors('fits', version),
        },
      });
      map.addLayer({
        id: `pin-${version}`,
        type: 'circle',
        source: `layer-${version}`,
        filter: ['==', ['get', 'draw'], 'pin'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#17182B',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    ready = true;
    render();
    options.onReady?.();
  });

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : null;
  observer?.observe(container);

  return {
    update(payload, view, cards) {
      current = { payload, view, cards };
      render();
    },
    destroy() {
      observer?.disconnect();
      clearMarkers();
      map.remove();
    },
  };
}

function pressed(id, on) {
  const node = document.getElementById(id);
  if (node) node.setAttribute('aria-pressed', on ? 'true' : 'false');
}

let mapBootedNode = null;
let mapBootedHandle = null;

export function bootMap() {
  const mapNode = document.getElementById('td-map');
  const cityNode = document.getElementById('td-city');
  if (!mapNode || !cityNode) return;
  if (mapBootedNode === mapNode) return;
  if (mapBootedHandle) {
    try { mapBootedHandle.destroy(); } catch { /* the previous container is already gone */ }
    mapBootedHandle = null;
  }
  mapBootedNode = mapNode;
  const params = new URLSearchParams(location.search);
  const requested = (cityNode.dataset.city || params.get('city') || '').trim();
  const state = {
    city: CITY_NAMES.includes(requested) ? requested : 'Los Angeles',
    district: params.get('district') === 'friction' ? 'friction' : 'fits',
    version: params.get('version') === 'v1' || params.get('version') === 'v2' ? params.get('version') : 'both',
    cards: [],
    payload: null,
    handle: null,
  };
  state.cards = cardsFor(state.city);
  for (const name of CITY_NAMES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === state.city;
    cityNode.append(option);
  }

  function syncToggles() {
    pressed('td-fits', state.district === 'fits');
    pressed('td-friction', state.district === 'friction');
    pressed('td-v1', state.version === 'v1');
    pressed('td-v2', state.version === 'v2');
    pressed('td-both', state.version === 'both');
  }

  function paintChrome() {
    const sub = document.getElementById('td-sub');
    const badge = document.getElementById('td-badge');
    const note = document.getElementById('td-note');
    const cards = document.getElementById('td-cards');
    const readout = document.getElementById('td-readout');
    if (sub) sub.textContent = cityNode.dataset.caption || `Japanese minimalist streetwear · 18–25 · ${state.city}`;
    if (badge && state.payload) {
      badge.textContent = state.payload.mode === 'mock' ? 'Mock data' : state.payload.basis === 'places' ? 'Place pins' : 'Qloo heatmap';
    }
    if (note && state.payload) note.textContent = state.payload.note || '';
    if (cards) {
      cards.replaceChildren();
      for (const card of state.cards) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = card.chosen ? 'td-card is-on' : 'td-card';
        button.setAttribute('aria-pressed', card.chosen ? 'true' : 'false');
        const img = document.createElement('img');
        img.alt = '';
        img.src = card.image;
        const title = document.createElement('b');
        title.textContent = card.name;
        const hint = document.createElement('span');
        hint.textContent = card.chosen ? 'Pinned' : 'Show pin';
        button.append(img, title, hint);
        button.addEventListener('click', () => {
          card.chosen = !card.chosen;
          paintChrome();
          draw();
        });
        cards.append(button);
      }
    }
    if (readout && state.payload) {
      readout.replaceChildren();
      for (const row of compareRows(state.payload, state.district)) {
        const line = document.createElement('div');
        line.className = 'td-row';
        const name = document.createElement('span');
        name.textContent = row.name;
        const value = document.createElement('b');
        value.textContent = state.version === 'both'
          ? `${formatWeight(row.v1)} → ${formatWeight(row.v2)}`
          : formatWeight(state.version === 'v2' ? row.v2 : row.v1);
        line.append(name, value);
        readout.append(line);
      }
    }
    syncToggles();
  }

  function draw() {
    if (!state.payload || !state.handle) return;
    state.handle.update(state.payload, { district: state.district, version: state.version }, state.cards);
  }

  async function load() {
    const note = document.getElementById('td-note');
    if (note) note.textContent = 'กำลังโหลดย่านจาก Qloo…';
    const chosen = state.cards.filter((card) => card.chosen).map((card) => ({
      id: card.id,
      name: card.name,
      lat: card.lat,
      lng: card.lng,
      image: card.image,
    }));
    const res = await fetch(`${apiBase()}/api/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        city: state.city,
        interests: { entities: ['td-mock-entity-velvet-circuit'], tags: ['td-mock-tag-paper-cut'] },
        locations: chosen,
        v2: { interests: { entities: ['td-mock-entity-northwind-audio'], tags: ['td-mock-tag-night-grid'] } },
      }),
    });
    if (mapBootedNode !== mapNode) return;
    if (!res.ok) throw new Error(`Map request failed (${res.status})`);
    state.payload = await res.json();
    if (mapBootedNode !== mapNode || !mapNode.isConnected) return;
    paintChrome();
    if (!state.handle) {
      state.handle = mountMap(mapNode, {
        payload: state.payload,
        view: { district: state.district, version: state.version },
        cards: state.cards,
      });
      mapBootedHandle = state.handle;
    } else {
      draw();
    }
  }

  cityNode.addEventListener('change', () => {
    state.city = cityNode.value;
    state.cards = cardsFor(state.city);
    load().catch((error) => {
      const node = document.getElementById('td-note');
      if (node) node.textContent = error instanceof Error ? error.message : 'Map request failed';
    });
  });
  document.getElementById('td-fits')?.addEventListener('click', () => { state.district = 'fits'; paintChrome(); draw(); });
  document.getElementById('td-friction')?.addEventListener('click', () => { state.district = 'friction'; paintChrome(); draw(); });
  document.getElementById('td-v1')?.addEventListener('click', () => { state.version = 'v1'; paintChrome(); draw(); });
  document.getElementById('td-v2')?.addEventListener('click', () => { state.version = 'v2'; paintChrome(); draw(); });
  document.getElementById('td-both')?.addEventListener('click', () => { state.version = 'both'; paintChrome(); draw(); });
  load().catch((error) => {
    const node = document.getElementById('td-note');
    if (node) node.textContent = error instanceof Error ? error.message : 'Map request failed';
  });
}

if (typeof document !== 'undefined' && document.getElementById('td-map') && document.getElementById('td-city')) bootMap();
