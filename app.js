// ==========================================
// 1. GLOBAL STATE INITIALIZATION
// ==========================================
let records = JSON.parse(localStorage.getItem('structuralRecords') || '[]');
let activeProjectId = localStorage.getItem('activeProjectId') || 'PROJ-001';
let projects = JSON.parse(localStorage.getItem('projectList') || '["PROJ-001"]');

if (!projects.includes(activeProjectId)) {
  projects.push(activeProjectId);
  localStorage.setItem('projectList', JSON.stringify(projects));
}

let mapInstance = null;
let mapDataGroup = null;
let osmTileLayer = null;
let layerControl = null;
let kmlMapOverlayLayer = null;
let customOverlayLayer = null;
let currentOverlayUrl = null;

// GPS Track Recording State
let isTracking = false;
let trackWatchId = null;
let gpsTrackPoints = JSON.parse(localStorage.getItem('gpsTraverseTrack') || '[]');
let gpsTrackPolyline = null;

// Countdown State
let deleteCountdownVal = 50;
let deleteTimerInterval = null;
let recordsPendingDeletion = [];

const ids = [
  'date', 'locPrefix', 'locNo', 'loc', 'lat', 'lon', 'alt', 'accuracy', 'lith',
  'mineralization', 'alteration', 'unit', 'type', 'customStructure', 'strike', 'dip',
  'dipdir', 'trend', 'plunge', 'sense', 'movementDir', 'photo', 'sampleType',
  'samplePrefix', 'sample', 'remarks', 'linType', 'linRake', 'pitchFrom', 'linTrend', 'linPlunge'
];

// ==========================================
// 2. CORE GEOLOGICAL & FORMATTING UTILITIES
// ==========================================
function isLinear(typeStr) {
  const t = (typeStr || '').toLowerCase();
  return t.includes('lineation') || t.includes('fold') || t.includes('axis') || t.includes('striae') || t.includes('slickenside') || t.includes('chatter');
}

function pad3(n) {
  if (n === '' || n === null || isNaN(n)) return '000';
  let x = ((Number(n) % 360) + 360) % 360;
  return String(Math.round(x)).padStart(3, '0');
}

function getQuadrant(deg) {
  if (isNaN(deg)) return '';
  const sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return sectors[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function persist() {
  localStorage.setItem('structuralRecords', JSON.stringify(records));
}

// ==========================================
// 3. PROJECT MANAGER
// ==========================================
function renderProjectDropdown() {
  const select = document.getElementById('projectIdSelect');
  if (!select) return;
  select.innerHTML = projects.map(p =>
    `<option value="${p}" ${p === activeProjectId ? 'selected' : ''}>${p}</option>`
  ).join('');
}

function switchProject() {
  const select = document.getElementById('projectIdSelect');
  if (!select) return;
  activeProjectId = select.value;
  localStorage.setItem('activeProjectId', activeProjectId);
  render();
  updatePreview();
}

function createNewProject() {
  const newId = prompt("Enter New Project ID (e.g. JAUNSAR-2026):");
  if (newId && newId.trim()) {
    const cleanId = newId.trim().toUpperCase().replace(/\s+/g, '-');
    if (!projects.includes(cleanId)) {
      projects.push(cleanId);
      localStorage.setItem('projectList', JSON.stringify(projects));
    }
    activeProjectId = cleanId;
    localStorage.setItem('activeProjectId', activeProjectId);
    renderProjectDropdown();
    render();
  }
}

// ==========================================
// 4. PREVIEW & STRUCTURAL CALCULATIONS
// ==========================================
function fmt() {
  let t = val('type');
  if (t === 'Other' && val('customStructure')) t = val('customStructure');
  const se = val('sense'), md = val('movementDir');
  let dataStr = '';

  if (isLinear(val('type'))) {
    const tr = val('trend') ? pad3(val('trend')) + '°' : '---°';
    const pl = val('plunge') ? val('plunge') + '°' : '--°';
    dataStr = `${pl} → ${tr} (${getQuadrant(parseFloat(val('trend')))})`;
  } else {
    const st = val('strike') ? pad3(val('strike')) : '000';
    const dp = val('dip') ? val('dip') + '°' : '--°';
    const dd = val('strike') ? pad3((parseInt(val('strike'), 10) + 90) % 360) : '000';
    const quad = val('strike') ? getQuadrant(parseInt(dd, 10)) : '';
    dataStr = `${st}°/${dp} (DD: ${dd}° ${quad})`.trim();
  }

  let s = `${t}: ${dataStr}`;
  if (val('linType') && val('linTrend') && val('linPlunge')) {
    s += ` | ${val('linType')}: ${val('linPlunge')} → ${val('linTrend')} (Pitch ${val('linRake')}°)`;
  }
  if (se) s += `, ${se} sense`;
  if (md) s += ` (${md})`;
  return s;
}

function updatePreview() {
  const previewEl = document.getElementById('preview');
  if (previewEl) previewEl.innerHTML = `<span class="fmt-preview">${fmt()}</span>`;
}

function toggleLineationSection() {
  const panel = document.getElementById('associatedLineationDiv');
  const btn = document.getElementById('toggleLineationBtn');
  if (!panel || !btn) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    panel.classList.remove('hidden');
    btn.innerHTML = '➖ Remove Lineation (Pitch)';
    calculateLineationFromPitch();
  } else {
    panel.classList.add('hidden');
    btn.innerHTML = '➕ Associated Lineation (Pitch / Rake)';
    ['linType', 'linRake', 'linTrend', 'linPlunge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    updatePreview();
  }
}

function calculateLineationFromPitch() {
  const strike = parseFloat(val('strike'));
  const dip = parseFloat(val('dip'));
  const rake = parseFloat(val('linRake'));
  const pitchFrom = val('pitchFrom');

  const trendInput = document.getElementById('linTrend');
  const plungeInput = document.getElementById('linPlunge');
  if (!trendInput || !plungeInput) return;

  if (isNaN(strike) || isNaN(dip) || isNaN(rake) || rake < 0 || rake > 90) {
    trendInput.value = '';
    plungeInput.value = '';
    updatePreview();
    return;
  }

  const radDip = (dip * Math.PI) / 180;
  const radRake = (rake * Math.PI) / 180;

  const sinPlunge = Math.sin(radDip) * Math.sin(radRake);
  const plungeDeg = Math.round((Math.asin(sinPlunge) * 180) / Math.PI);

  const cosPlunge = Math.cos((plungeDeg * Math.PI) / 180);
  const betaDeg = cosPlunge !== 0 ? (Math.acos(Math.cos(radRake) / cosPlunge) * 180) / Math.PI : 0;

  let trendDeg = (pitchFrom === 'opposite')
    ? (strike + 180 - betaDeg + 360) % 360
    : (strike + betaDeg + 360) % 360;

  trendDeg = Math.round(trendDeg);
  trendInput.value = pad3(trendDeg) + '°';
  plungeInput.value = String(plungeDeg).padStart(2, '0') + '°';
  updatePreview();
}

// ==========================================
// 5. GPS SYNCHRONIZATION ENGINE
// ==========================================
function getGPS() {
  const latField = document.getElementById('lat');
  const lonField = document.getElementById('lon');
  const accField = document.getElementById('accuracy');
  const altField = document.getElementById('alt');

  if (!navigator.geolocation) {
    alert('Geolocation is unsupported by your browser/device.');
    return;
  }

  if (latField) latField.value = 'Syncing...';
  if (lonField) lonField.value = 'Syncing...';
  if (accField) accField.value = '...';

  navigator.geolocation.getCurrentPosition(
    p => {
      if (latField) latField.value = p.coords.latitude.toFixed(6);
      if (lonField) lonField.value = p.coords.longitude.toFixed(6);
      if (accField) accField.value = Math.round(p.coords.accuracy) + 'm';
      if (altField) altField.value = p.coords.altitude ? p.coords.altitude.toFixed(1) : 'N/A';
    },
    err => {
      if (latField) latField.value = '';
      if (lonField) lonField.value = '';
      if (accField) accField.value = 'Error';
      alert('GPS Signal Lock Failed: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ==========================================
// 6. RECORD LOGGING & MANAGEMENT
// ==========================================
function saveEntry() {
  const r = {
    id: Date.now(),
    projectId: activeProjectId,
    formatted: fmt(),
    showOnMap: true,
    selectedForDelete: false
  };

  ids.forEach(id => r[id] = val(id));

  const sampleCheckbox = document.getElementById('takeSample');
  if (!sampleCheckbox || !sampleCheckbox.checked) {
    r['sample'] = '';
    r['sampleType'] = '';
  } else {
    let sCounter = parseInt(localStorage.getItem('sampleCounter') || '1', 10);
    localStorage.setItem('sampleCounter', sCounter + 1);
  }

  records.unshift(r);

  // Increment Location Counter
  const locMode = document.getElementById('locCountMode')?.value || 'continue';
  let lCounter = parseInt(localStorage.getItem('locationCounter') || '1', 10);
  if (locMode === 'continue') {
    localStorage.setItem('locationCounter', lCounter + 1);
  }

  persist();
  clearForm(false);
  updateLocationID();
  render();
  alert('Station record saved successfully!');
}

function clearForm(resetDate = true) {
  const retainKeys = resetDate ? [] : ['loc', 'lith', 'unit', 'lat', 'lon', 'alt', 'accuracy'];
  ids.forEach(id => {
    if (!retainKeys.includes(id) && id !== 'locPrefix' && id !== 'samplePrefix' && id !== 'locNo' && id !== 'type') {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
  });

  const takeSampleEl = document.getElementById('takeSample');
  if (takeSampleEl) {
    takeSampleEl.checked = false;
    toggleSampleState();
  }
  updatePreview();
}

function render() {
  const projectRecords = records.filter(r => (r.projectId || 'PROJ-001') === activeProjectId);
  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = projectRecords.length;

  const listEl = document.getElementById('list');
  if (!listEl) return;

  listEl.innerHTML = projectRecords.map(r => `
    <div class="entry">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label style="font-weight:bold; font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" onchange="toggleRecordSelection(${r.id}, this.checked)" ${r.selectedForDelete ? 'checked' : ''}>
          <span>Station: <b>${escapeHTML(r.locNo || 'N/A')}</b></span>
        </label>
        <label style="font-size:11px; background:#eef2f5; padding:2px 8px; border-radius:4px; cursor:pointer;">
          <input type="checkbox" onchange="toggleMapRecord(${r.id}, this.checked)" ${r.showOnMap !== false ? 'checked' : ''}>
          Map
        </label>
      </div>
      <div style="font-size:13px; font-weight:bold; color:var(--primary);">${escapeHTML(r.formatted || '')}</div>
      <div style="font-size:12px; color:#555; margin-top:2px;">
        ${r.unit ? `Formation: ${escapeHTML(r.unit)} | ` : ''}${r.lith ? `Lithology: ${escapeHTML(r.lith)}` : ''}
      </div>
      <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
        Coord: ${r.lat || '-'}, ${r.lon || '-'} | Sample: <b>${escapeHTML(r.sample || 'None')}</b>
      </div>
    </div>
  `).join('');

  updateMapDisplay();
}

function toggleRecordSelection(id, isSelected) {
  const rec = records.find(r => r.id === id);
  if (rec) {
    rec.selectedForDelete = isSelected;
    persist();
  }
}

// ==========================================
// 7. 50-SECOND SAFE DELETION SYSTEM
// ==========================================
function initiateDeleteSelected() {
  recordsPendingDeletion = records.filter(r => (r.projectId || 'PROJ-001') === activeProjectId && r.selectedForDelete);
  
  if (recordsPendingDeletion.length === 0) {
    alert("No records selected! Check the box next to any station you wish to delete.");
    return;
  }

  const countDisplay = document.getElementById('deleteSelectedCount');
  if (countDisplay) countDisplay.textContent = recordsPendingDeletion.length;

  deleteCountdownVal = 50;
  const timerDisplay = document.getElementById('deleteCountdownTimer');
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  
  if (timerDisplay) timerDisplay.textContent = `${deleteCountdownVal}s`;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
    confirmBtn.style.cursor = 'not-allowed';
  }

  const modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.style.display = 'block';

  clearInterval(deleteTimerInterval);
  deleteTimerInterval = setInterval(() => {
    deleteCountdownVal--;
    if (timerDisplay) timerDisplay.textContent = `${deleteCountdownVal}s`;
    
    if (deleteCountdownVal <= 0) {
      clearInterval(deleteTimerInterval);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
      }
      if (timerDisplay) timerDisplay.textContent = 'Unlocked';
    }
  }, 1000);
}

function executeDeletion() {
  const idsToDelete = new Set(recordsPendingDeletion.map(r => r.id));
  records = records.filter(r => !idsToDelete.has(r.id));
  persist();
  abortDeletion();
  render();
  alert("Selected records permanently deleted.");
}

function abortDeletion() {
  clearInterval(deleteTimerInterval);
  const modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// 8. POPUP MAP & IN-MAP STATION EDITING
// ==========================================
function openSpatialMap() {
  const modal = document.getElementById('mapModal');
  if (modal) modal.style.display = 'block';

  setTimeout(() => {
    const validPoints = records.filter(r => r.lat && r.lon && !isNaN(parseFloat(r.lat)) && !isNaN(parseFloat(r.lon)));
    const firstLat = validPoints.length > 0 ? parseFloat(validPoints[0].lat) : 30.0;
    const firstLon = validPoints.length > 0 ? parseFloat(validPoints[0].lon) : 78.0;

    if (!mapInstance) {
      mapInstance = L.map('map').setView([firstLat, firstLon], 13);
      osmTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapInstance);

      mapDataGroup = L.layerGroup().addTo(mapInstance);
      gpsTrackPolyline = L.polyline([], { color: '#0984e3', weight: 4 }).addTo(mapInstance);
      renderStoredGpsTrack();
    } else {
      mapInstance.invalidateSize();
    }
    updateMapDisplay();
  }, 100);
}

function closeSpatialMap() {
  const modal = document.getElementById('mapModal');
  if (modal) modal.style.display = 'none';
}

function updateMapDisplay() {
  if (!mapInstance || !mapDataGroup) return;
  mapDataGroup.clearLayers();

  const validRecords = records.filter(r =>
    (r.projectId || 'PROJ-001') === activeProjectId &&
    r.showOnMap !== false &&
    r.lat && r.lon &&
    !isNaN(parseFloat(r.lat)) && !isNaN(parseFloat(r.lon))
  );

  validRecords.forEach(r => {
    const latlng = [parseFloat(r.lat), parseFloat(r.lon)];
    const marker = L.circleMarker(latlng, {
      radius: 7,
      fillColor: '#e67e22',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9
    });

    // In-Map Station Popup with Edit Button
    const popupHtml = `
      <div style="font-size:12px; font-family:sans-serif; min-width:180px;">
        <div style="font-weight:bold; font-size:13px; color:#1f3a5f; border-bottom:1px solid #ddd; padding-bottom:3px; margin-bottom:4px;">
          📍 Station: ${escapeHTML(r.locNo || 'N/A')}
        </div>
        <div><b>Structure:</b> ${escapeHTML(r.formatted || 'N/A')}</div>
        <div><b>Lithology:</b> ${escapeHTML(r.lith || '-')}</div>
        <div><b>Formation:</b> ${escapeHTML(r.unit || '-')}</div>
        ${r.remarks ? `<div style="font-style:italic; margin-top:4px; color:#555;">${escapeHTML(r.remarks)}</div>` : ''}
        <button type="button" onclick="openStationEdit(${r.id})" class="btn-ok" style="width:100%; margin-top:8px; padding:4px 8px; font-size:11px;">
          ✏️ Edit Station Data
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    mapDataGroup.addLayer(marker);
  });
}

// In-Map Station Edit Functionality
function openStationEdit(id) {
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  document.getElementById('editRecordId').value = rec.id;
  document.getElementById('editLocNo').value = rec.locNo || '';
  document.getElementById('editLith').value = rec.lith || '';
  document.getElementById('editUnit').value = rec.unit || '';
  document.getElementById('editStrikeTrend').value = rec.strike || rec.trend || '';
  document.getElementById('editDipPlunge').value = rec.dip || rec.plunge || '';
  document.getElementById('editMinAlt').value = (rec.mineralization || '') + (rec.alteration ? `, ${rec.alteration}` : '');
  document.getElementById('editRemarks').value = rec.remarks || '';

  const editModal = document.getElementById('editModal');
  if (editModal) editModal.style.display = 'block';
}

function closeEditModal() {
  const editModal = document.getElementById('editModal');
  if (editModal) editModal.style.display = 'none';
}

function saveStationEdit() {
  const id = parseInt(document.getElementById('editRecordId').value, 10);
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  rec.locNo = document.getElementById('editLocNo').value;
  rec.lith = document.getElementById('editLith').value;
  rec.unit = document.getElementById('editUnit').value;
  if (isLinear(rec.type)) {
    rec.trend = document.getElementById('editStrikeTrend').value;
    rec.plunge = document.getElementById('editDipPlunge').value;
  } else {
    rec.strike = document.getElementById('editStrikeTrend').value;
    rec.dip = document.getElementById('editDipPlunge').value;
  }
  rec.remarks = document.getElementById('editRemarks').value;

  persist();
  closeEditModal();
  render();
  alert("Station data updated successfully!");
}

// ==========================================
// 9. LIVE GPS TRACK RECORDER
// ==========================================
function toggleGpsTracking() {
  const btn = document.getElementById('startTrackBtn');
  if (!isTracking) {
    if (!navigator.geolocation) {
      alert("GPS not supported.");
      return;
    }
    isTracking = true;
    if (btn) {
      btn.textContent = '⏸ Pause Track';
      btn.className = 'btn-danger btn-small';
    }

    trackWatchId = navigator.geolocation.watchPosition(
      pos => {
        const point = [pos.coords.latitude, pos.coords.longitude];
        gpsTrackPoints.push(point);
        localStorage.setItem('gpsTraverseTrack', JSON.stringify(gpsTrackPoints));
        renderStoredGpsTrack();
      },
      err => console.warn('Track Error: ' + err.message),
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
  } else {
    isTracking = false;
    if (btn) {
      btn.textContent = '▶ Resume Track';
      btn.className = 'btn-ok btn-small';
    }
    if (trackWatchId) navigator.geolocation.clearWatch(trackWatchId);
  }
}

function renderStoredGpsTrack() {
  if (!gpsTrackPolyline) return;
  gpsTrackPolyline.setLatLngs(gpsTrackPoints);
  
  // Calculate Traverse Distance
  let totalMeters = 0;
  for (let i = 1; i < gpsTrackPoints.length; i++) {
    const from = L.latLng(gpsTrackPoints[i - 1]);
    const to = L.latLng(gpsTrackPoints[i]);
    totalMeters += from.distanceTo(to);
  }
  const distEl = document.getElementById('trackDistance');
  if (distEl) distEl.textContent = `Dist: ${(totalMeters / 1000).toFixed(2)} km`;
}

function clearGpsTrack() {
  if (confirm("Clear recorded GPS track points?")) {
    gpsTrackPoints = [];
    localStorage.removeItem('gpsTraverseTrack');
    renderStoredGpsTrack();
  }
}

// ==========================================
// 10. EXPORTERS & EVENT LISTENERS
// ==========================================
function exportCSV() {
  const projectRecords = records.filter(r => (r.projectId || 'PROJ-001') === activeProjectId);
  if (projectRecords.length === 0) { alert('No data to export.'); return; }
  const cols = ['projectId', 'date', 'locNo', 'lat', 'lon', 'alt', 'unit', 'lith', 'type', 'strike', 'dip', 'trend', 'plunge', 'sample', 'remarks'];
  const csv = [cols.join(',')].concat(projectRecords.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  download(`structural_data_${activeProjectId}.csv`, csv, 'text/csv');
}

function exportGeoJSON() {
  const valid = records.filter(r => (r.projectId || 'PROJ-001') === activeProjectId && r.lat && r.lon);
  const geojson = {
    type: "FeatureCollection",
    features: valid.map(r => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
      properties: { ...r }
    }))
  };
  download(`traverse_${activeProjectId}.geojson`, JSON.stringify(geojson, null, 2), 'application/geo+json');
}

function exportKML() {
  const valid = records.filter(r => (r.projectId || 'PROJ-001') === activeProjectId && r.lat && r.lon);
  let kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${activeProjectId}</name>`;
  valid.forEach(r => {
    kml += `<Placemark><name>${escapeHTML(r.locNo)}</name><description>${escapeHTML(r.formatted)}</description><Point><coordinates>${r.lon},${r.lat},${r.alt || 0}</coordinates></Point></Placemark>`;
  });
  kml += `</Document></kml>`;
  download(`traverse_${activeProjectId}.kml`, kml, 'application/vnd.google-earth.kml+xml');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

function toggleMapRecord(id, isChecked) {
  const rec = records.find(r => r.id === id);
  if (rec) {
    rec.showOnMap = isChecked;
    persist();
    updateMapDisplay();
  }
}

function toggleSelectAllMap(isChecked) {
  records.forEach(r => {
    if ((r.projectId || 'PROJ-001') === activeProjectId) r.showOnMap = isChecked;
  });
  persist();
  render();
}

function handleLocModeChange() {
  const mode = document.getElementById('locCountMode')?.value;
  const locNo = document.getElementById('locNo');
  if (mode === 'manual') {
    if (locNo) locNo.readOnly = false;
  } else {
    if (locNo) locNo.readOnly = true;
    updateLocationID();
  }
}

function updateLocationID() {
  const prefix = document.getElementById('locPrefix')?.value || 'JU';
  const num = parseInt(localStorage.getItem('locationCounter') || '1', 10);
  const locNo = document.getElementById('locNo');
  if (locNo) locNo.value = `${prefix}-${String(num).padStart(3, '0')}`;
}

function toggleSampleState() {
  const isChecked = document.getElementById('takeSample')?.checked;
  ['sampleType', 'samplePrefix', 'sampleCounterBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isChecked;
  });
  const sample = document.getElementById('sample');
  if (sample) sample.value = isChecked ? `DD-${String(localStorage.getItem('sampleCounter') || '1').padStart(3, '0')}` : 'No Sample Collected';
}

function setSampleCounter() {
  const input = prompt("Set next sample sequence number:");
  if (input !== null) {
    localStorage.setItem('sampleCounter', parseInt(input, 10) || 1);
    toggleSampleState();
  }
}

function startVoiceNote() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice recognition not supported."); return; }
  const rec = new SR();
  rec.onresult = e => {
    document.getElementById('remarks').value += ' ' + e.results[0][0].transcript;
  };
  rec.start();
}

// Initializer
document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('date');
  if (dateEl && !dateEl.value) dateEl.valueAsDate = new Date();

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
  });

  const typeEl = document.getElementById('type');
  if (typeEl) {
    typeEl.addEventListener('change', function () {
      const isLin = isLinear(this.value);
      document.getElementById('planarFields')?.classList.toggle('hidden', isLin);
      document.getElementById('linearFields')?.classList.toggle('hidden', !isLin);
      document.getElementById('customStructureDiv')?.classList.toggle('hidden', this.value !== 'Other');
      updatePreview();
    });
  }

  const strikeEl = document.getElementById('strike');
  if (strikeEl) {
    strikeEl.addEventListener('input', function () {
      const strike = parseInt(this.value, 10);
      const ddEl = document.getElementById('dipdir');
      if (!isNaN(strike) && ddEl) {
        const dd = (strike + 90) % 360;
        ddEl.value = `${pad3(dd)}° (${getQuadrant(dd)})`;
      }
      calculateLineationFromPitch();
    });
  }

  const dipEl = document.getElementById('dip');
  if (dipEl) dipEl.addEventListener('input', calculateLineationFromPitch);

  renderProjectDropdown();
  updateLocationID();
  toggleSampleState();
  render();
  updatePreview();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
  });
}
