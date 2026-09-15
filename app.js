const OSRM_BASE = 'https://router.project-osrm.org';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const EXACT_CAP = 13; // Held-Karp beyond this gets slow; heuristic wins by default.

const state = {
  locations: [], // { id, lat, lng, label, marker }
  nextId: 1,
  routeLine: null,
};

const map = L.map('map').setView([25.6866, -100.3161], 12); // Monterrey, MX by default
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

const listEl = document.getElementById('location-list');
const calcBtn = document.getElementById('calc-btn');
const clearBtn = document.getElementById('clear-btn');
const statusEl = document.getElementById('status');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
const racePanel = document.getElementById('race-panel');
const raceExactEl = document.getElementById('race-exact');
const raceHeuristicEl = document.getElementById('race-heuristic');
const resultPanel = document.getElementById('result-panel');
const resultSummaryEl = document.getElementById('result-summary');
const resultOrderEl = document.getElementById('result-order');

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#e05353' : '#f0c419';
}

function makeIcon(index, isStart) {
  return L.divIcon({
    className: 'leaflet-div-icon' + (isStart ? ' start' : ''),
    html: String(index + 1),
    iconSize: [26, 26],
  });
}

function addLocation(lat, lng, label) {
  const loc = { id: state.nextId++, lat, lng, label: label || `Punto ${state.locations.length + 1}` };
  loc.marker = L.marker([lat, lng], { icon: makeIcon(state.locations.length, state.locations.length === 0) }).addTo(map);
  loc.marker.on('click', () => removeLocation(loc.id));
  loc.marker.bindTooltip(loc.label);
  state.locations.push(loc);
  refreshMarkersAndList();
}

function removeLocation(id) {
  const loc = state.locations.find((l) => l.id === id);
  if (!loc) return;
  map.removeLayer(loc.marker);
  state.locations = state.locations.filter((l) => l.id !== id);
  refreshMarkersAndList();
}

function makeStart(id) {
  const idx = state.locations.findIndex((l) => l.id === id);
  if (idx <= 0) return;
  const [loc] = state.locations.splice(idx, 1);
  state.locations.unshift(loc);
  refreshMarkersAndList();
}

function refreshMarkersAndList() {
  state.locations.forEach((loc, i) => {
    loc.marker.setIcon(makeIcon(i, i === 0));
  });

  listEl.innerHTML = '';
  state.locations.forEach((loc, i) => {
    const li = document.createElement('li');
    if (i === 0) li.classList.add('is-start');
    li.innerHTML = `
      <span class="loc-badge">${i + 1}</span>
      <span class="loc-label" title="${loc.label}">${loc.label}</span>
      <span class="loc-actions">
        ${i !== 0 ? '<button data-action="start" title="Hacer inicio">🏁</button>' : ''}
        <button data-action="remove" title="Quitar">✕</button>
      </span>
    `;
    li.querySelector('[data-action="remove"]').addEventListener('click', () => removeLocation(loc.id));
    const startBtn = li.querySelector('[data-action="start"]');
    if (startBtn) startBtn.addEventListener('click', () => makeStart(loc.id));
    listEl.appendChild(li);
  });

  calcBtn.disabled = state.locations.length < 2;
  clearRoute();
}

function clearRoute() {
  if (state.routeLine) {
    map.removeLayer(state.routeLine);
    state.routeLine = null;
  }
  resultPanel.classList.add('hidden');
  racePanel.classList.add('hidden');
}

clearBtn.addEventListener('click', () => {
  state.locations.forEach((l) => map.removeLayer(l.marker));
  state.locations = [];
  refreshMarkersAndList();
  setStatus('');
});

map.on('click', (e) => {
  addLocation(e.latlng.lat, e.latlng.lng);
});

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchResultsEl.innerHTML = 'Buscando…';
  try {
    const url = `${NOMINATIM_BASE}/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const data = await res.json();
    searchResultsEl.innerHTML = '';
    if (!data.length) {
      searchResultsEl.innerHTML = '<div class="search-result">Sin resultados</div>';
      return;
    }
    data.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'search-result';
      div.textContent = item.display_name;
      div.addEventListener('click', () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        addLocation(lat, lng, item.display_name.split(',').slice(0, 2).join(','));
        map.setView([lat, lng], 15);
        searchResultsEl.innerHTML = '';
        searchInput.value = '';
      });
      searchResultsEl.appendChild(div);
    });
  } catch (err) {
    searchResultsEl.innerHTML = '<div class="search-result">Error al buscar</div>';
  }
});

async function fetchDurationMatrix(locations) {
  const coords = locations.map((l) => `${l.lng},${l.lat}`).join(';');
  const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM table request failed');
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(data.message || 'OSRM table error');
  return data.durations;
}

async function fetchRouteGeometry(orderedLocations) {
  const loop = orderedLocations.concat([orderedLocations[0]]);
  const coords = loop.map((l) => `${l.lng},${l.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM route request failed');
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(data.message || 'OSRM route error');
  return data.routes[0];
}

function runWorker(path, payload) {
  return new Promise((resolve) => {
    const worker = new Worker(path);
    worker.onmessage = (e) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (err) => {
      worker.terminate();
      resolve({ algorithm: payload._label, skipped: true, error: err.message });
    };
    worker.postMessage(payload);
  });
}

function fmtMs(ms) {
  return ms < 1 ? '<1 ms' : `${ms.toFixed(1)} ms`;
}

function fmtDuration(seconds) {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m} min`;
}

function fmtDistance(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

calcBtn.addEventListener('click', async () => {
  const locations = state.locations;
  if (locations.length < 2) return;

  calcBtn.disabled = true;
  clearRoute();
  setStatus('Calculando tiempos reales de viaje entre puntos…');

  let matrix;
  try {
    matrix = await fetchDurationMatrix(locations);
  } catch (err) {
    setStatus('No se pudo obtener la matriz de tiempos (OSRM). Intenta de nuevo. ' + err.message, true);
    calcBtn.disabled = false;
    return;
  }

  setStatus('Resolviendo la ruta (carrera: exacto vs. heurístico)…');
  racePanel.classList.remove('hidden');
  raceExactEl.className = 'race-row';
  raceHeuristicEl.className = 'race-row';
  raceExactEl.querySelector('.algo-time').textContent = 'calculando…';
  raceHeuristicEl.querySelector('.algo-time').textContent = 'calculando…';

  const exactPromise = runWorker('workers/exactWorker.js', { matrix, cap: EXACT_CAP, _label: 'exact' });
  const heuristicPromise = runWorker('workers/heuristicWorker.js', { matrix, _label: 'heuristic' });

  let winner = null;
  const results = {};

  const tagResult = (res) => {
    results[res.algorithm] = res;
    const el = res.algorithm === 'exact' ? raceExactEl : raceHeuristicEl;
    if (res.skipped) {
      el.classList.add('skipped');
      el.querySelector('.algo-time').textContent = 'omitido (demasiados puntos)';
    } else {
      el.querySelector('.algo-time').textContent = fmtMs(res.timeMs);
    }
    if (!winner && !res.skipped) {
      winner = res;
      el.classList.add('winner');
    }
  };

  const [a, b] = await Promise.all([
    exactPromise.then((r) => { tagResult(r); return r; }),
    heuristicPromise.then((r) => { tagResult(r); return r; }),
  ]);

  // Winner = whichever produced a usable order first; Promise.all above waits
  // for both so we can show the full scoreboard, but `winner` was set by the
  // first tagResult call to complete (true race), not by array order.
  if (!winner) {
    setStatus('Ningún algoritmo pudo resolver la ruta.', true);
    calcBtn.disabled = false;
    return;
  }

  const orderedLocations = winner.order.map((i) => locations[i]);

  setStatus('Trazando la ruta sobre calles reales…');
  let route;
  try {
    route = await fetchRouteGeometry(orderedLocations);
  } catch (err) {
    setStatus('No se pudo trazar la geometría de la ruta. ' + err.message, true);
    calcBtn.disabled = false;
    return;
  }

  if (state.routeLine) map.removeLayer(state.routeLine);
  state.routeLine = L.geoJSON(route.geometry, { style: { color: '#3b6fe0', weight: 5, opacity: 0.85 } }).addTo(map);
  map.fitBounds(state.routeLine.getBounds(), { padding: [30, 30] });

  const algoName = winner.algorithm === 'exact' ? 'exacto (Held-Karp)' : 'heurístico (vecino cercano + 2-opt)';
  resultSummaryEl.textContent = `Algoritmo ganador: ${algoName}. Distancia total: ${fmtDistance(route.distance)}. Tiempo estimado: ${fmtDuration(route.duration)}.`;
  resultOrderEl.innerHTML = '';
  orderedLocations.concat([orderedLocations[0]]).forEach((loc, i) => {
    const li = document.createElement('li');
    li.textContent = i === orderedLocations.length ? `${loc.label} (regreso)` : loc.label;
    resultOrderEl.appendChild(li);
  });
  resultPanel.classList.remove('hidden');

  setStatus('');
  calcBtn.disabled = false;
});
