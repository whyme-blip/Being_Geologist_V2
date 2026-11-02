// =========================================================
// GEOPDF-ENGINE.JS - OGC / ADOBE GEOSPATIAL PDF ENGINE
// High-Precision Projection, Y-Inverted Affine & Rotated Quad Overlay
// =========================================================

// State Handles
let currentGeoPdfLayer = null;
let currentGeoPdfBlobUrl = null;
let activeOverlayBounds = null;
let overlayLatOffset = 0;
let overlayLonOffset = 0;

// Projected coordinates store for Rotated Image Overlay
let currentQuadCorners = null; // { topleft, topright, bottomleft }

// Helper: Convert UTM/projected meters or reverse lat/lon to WGS84 [lat, lon]
function projectToWGS84(x, y, gcsStr) {
  if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return [y, x];
  if (Math.abs(x) <= 90 && Math.abs(y) <= 180) return [x, y];

  let utmZone = 43; // Default NW Himalaya (Shimla/Chaupal region)
  const zoneMatch = gcsStr ? gcsStr.match(/UTM\s*zone\s*(\d+)/i) : null;
  if (zoneMatch && zoneMatch[1]) {
    utmZone = parseInt(zoneMatch[1], 10);
  }

  try {
    if (typeof proj4 !== 'undefined') {
      const utmProj = `+proj=utm +zone=${utmZone} +datum=WGS84 +units=m +no_defs`;
      const wgs84 = proj4(utmProj, 'EPSG:4326', [x, y]);
      return [wgs84[1], wgs84[0]];
    }
  } catch (e) {
    console.warn("Proj4 transformation error:", e);
  }

  return [y, x];
}

function processGptsArray(pts, gcsContext) {
  let coords = [];
  for (let i = 0; i < pts.length; i += 2) {
    const v1 = pts[i];
    const v2 = pts[i + 1];
    if (v1 !== undefined && v2 !== undefined && !isNaN(v1) && !isNaN(v2)) {
      coords.push(projectToWGS84(v2, v1, gcsContext));
    }
  }

  if (coords.length === 0) return null;

  const lats = coords.map(c => c[0]);
  const lons = coords.map(c => c[1]);
  return [
    [Math.min(...lats), Math.min(...lons)], // SW [minLat, minLon]
    [Math.max(...lats), Math.max(...lons)]  // NE [maxLat, maxLon]
  ];
}

function parseDmsStringToDecimal(str) {
  if (!str) return null;
  const clean = str.replace(/[–—]/g, '-').trim();
  const match = clean.match(/(\d{1,3})[°\s-]+(?:(\d{1,2})['′\s]*)?(?:(\d{1,2}(?:\.\d+)?)["″\s]*)?([NSEW])?/i);
  if (!match) return null;

  const deg = parseFloat(match[1]);
  const min = match[2] ? parseFloat(match[2]) : 0;
  const sec = match[3] ? parseFloat(match[3]) : 0;
  let hemi = match[4] ? match[4].toUpperCase() : '';

  if (!hemi) {
    if (deg >= 25 && deg <= 38) hemi = 'N';
    else if (deg >= 70 && deg <= 85) hemi = 'E';
  }

  let dd = deg + (min / 60) + (sec / 3600);
  if (hemi === 'S' || hemi === 'W') dd = -dd;
  return dd;
}

async function extractBoundsFromPageText(page) {
  try {
    const textContent = await page.getTextContent();
    const lats = [];
    const lons = [];

    textContent.items.forEach(item => {
      const s = item.str.trim();
      if (!s || s.length < 3) return;

      if ((/[NS]/i.test(s) && /\d{2}[°\s-]/.test(s)) || /^3[01][°\s-]\d{2}/.test(s)) {
        const lat = parseDmsStringToDecimal(s);
        if (lat !== null && lat >= 30.0 && lat <= 32.5) {
          lats.push(lat);
        }
      }

      if ((/[EW]/i.test(s) && /\d{2,3}[°\s-]/.test(s)) || /^7[678][°\s-]\d{2}/.test(s)) {
        const lon = parseDmsStringToDecimal(s);
        if (lon !== null && lon >= 76.5 && lon <= 78.8) {
          lons.push(lon);
        }
      }
    });

    if (lats.length >= 2 && lons.length >= 2) {
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);

      if (maxLat > minLat && maxLon > minLon) {
        return [
          [minLat, minLon],
          [maxLat, maxLon]
        ];
      }
    }
  } catch (e) {
    console.warn("Text content parsing error:", e);
  }
  return null;
}

// =========================================================
// AFFINE MATRIX SOLVER (PDF Bottom-Left to Canvas Top-Left Inversion)
// =========================================================
function computeAffineTransform(points) {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
  let sumLat = 0, sumLatX = 0, sumLatY = 0;
  let sumLon = 0, sumLonX = 0, sumLonY = 0;

  for (let i = 0; i < n; i++) {
    const { x, y, lat, lon } = points[i];
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumY2 += y * y;
    sumXY += x * y;
    sumLat += lat;
    sumLatX += lat * x;
    sumLatY += lat * y;
    sumLon += lon;
    sumLonX += lon * x;
    sumLonY += lon * y;
  }

  const det = n * (sumX2 * sumY2 - sumXY * sumXY) -
              sumX * (sumX * sumY2 - sumY * sumXY) +
              sumY * (sumX * sumXY - sumY * sumX2);

  if (Math.abs(det) < 1e-12) return null;

  const a = ((sumLatX * sumY2 - sumLatY * sumXY) * n - sumX * (sumLat * sumY2 - sumLatY * sumY) + sumY * (sumLat * sumXY - sumLatX * sumY)) / det;
  const b = ((sumX2 * sumLatY - sumXY * sumLatX) * n - (sumX2 * sumLat - sumX * sumLatX) * sumY + sumX * (sumXY * sumLat - sumX * sumLatY)) / det;
  const c = (sumLat - a * sumX - b * sumY) / n;

  const d = ((sumLonX * sumY2 - sumLonY * sumXY) * n - sumX * (sumLon * sumY2 - sumLonY * sumY) + sumY * (sumLon * sumXY - sumLonX * sumY)) / det;
  const e = ((sumX2 * sumLonY - sumXY * sumLonX) * n - (sumX2 * sumLon - sumX * sumLonX) * sumY + sumX * (sumXY * sumLon - sumX * sumLonY)) / det;
  const f = ((sumLon - d * sumX - e * sumY)) / n;

  return {
    forward: (x, y) => ({
      lat: a * x + b * y + c,
      lon: d * x + e * y + f
    })
  };
}

/**
 * Maps PDF page points to Geographic World Coordinates
 * Correctly accounts for PDF (y-up) vs Image (y-down) orientation.
 */
function calculatePageWorldBounds(mediaBox, bbox, gpts, gcsContext) {
  const pw0 = mediaBox[0], ph0 = mediaBox[1], pw1 = mediaBox[2], ph1 = mediaBox[3];
  const bx0 = bbox[0], by0 = bbox[1], bx1 = bbox[2], by1 = bbox[3];

  const wgsGpts = [];
  for (let i = 0; i < gpts.length; i += 2) {
    const pt = projectToWGS84(gpts[i + 1], gpts[i], gcsContext);
    wgsGpts.push({ lat: pt[0], lon: pt[1] });
  }

  // PDF /GPTS sequence standard (OGC 08-139r1):
  // 1: Lower-Left, 2: Lower-Right, 3: Upper-Right, 4: Upper-Left
  // We map directly in PDF point space:
  const gcp = [
    { x: bx0, y: by0, lat: wgsGpts[0].lat, lon: wgsGpts[0].lon },
    { x: bx1, y: by0, lat: wgsGpts[1].lat, lon: wgsGpts[1].lon },
    { x: bx1, y: by1, lat: wgsGpts[2].lat, lon: wgsGpts[2].lon },
    { x: bx0, y: by1, lat: wgsGpts[3].lat, lon: wgsGpts[3].lon }
  ];

  const affine = computeAffineTransform(gcp);
  if (!affine) return null;

  // Extrapolate the 4 outer corners of the physical PDF page (MediaBox)
  const cBottomLeft  = affine.forward(pw0, ph0); // PDF Lower-Left
  const cBottomRight = affine.forward(pw1, ph0); // PDF Lower-Right
  const cTopRight    = affine.forward(pw1, ph1); // PDF Upper-Right
  const cTopLeft     = affine.forward(pw0, ph1); // PDF Upper-Left

  const lats = [cBottomLeft.lat, cBottomRight.lat, cTopRight.lat, cTopLeft.lat];
  const lons = [cBottomLeft.lon, cBottomRight.lon, cTopRight.lon, cTopLeft.lon];

  return {
    leafletBounds: [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)]
    ],
    corners: {
      topLeft: L.latLng(cTopLeft.lat, cTopLeft.lon),
      topRight: L.latLng(cTopRight.lat, cTopRight.lon),
      bottomLeft: L.latLng(cBottomLeft.lat, cBottomLeft.lon)
    },
    affine: affine
  };
}

// ------------------------------------------
// OVERLAY CALIBRATION, NUDGE & OPACITY CONTROLS
// ------------------------------------------
function toggleNudgeControls() {
  const nudgeBar = document.getElementById('overlayNudgeControls');
  if (!nudgeBar) return;
  const isHidden = (nudgeBar.style.display === 'none' || !nudgeBar.style.display);
  nudgeBar.style.display = isHidden ? 'block' : 'none';
  if (isHidden && !activeOverlayBounds && currentGeoPdfLayer) {
    const b = currentGeoPdfLayer.getBounds ? currentGeoPdfLayer.getBounds() : null;
    if (b) {
      activeOverlayBounds = [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()]
      ];
    }
  }
}

function showNudgeControls(bounds) {
  activeOverlayBounds = [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1]]
  ];

  const savedOffset = JSON.parse(localStorage.getItem(`overlayOffset_${activeProjectId}`) || '{"lat":0,"lon":0}');
  overlayLatOffset = savedOffset.lat || 0;
  overlayLonOffset = savedOffset.lon || 0;

  const nudgeBar = document.getElementById('overlayNudgeControls');
  if (nudgeBar) {
    nudgeBar.style.display = 'block';
  }

  const slider = document.getElementById('overlayOpacitySlider');
  if (slider) slider.value = 0.85;
  const label = document.getElementById('overlayOpacityVal');
  if (label) label.textContent = '85%';

  applyNudgedBounds();
}

function changeOverlayOpacity(val) {
  const opacity = parseFloat(val);
  const label = document.getElementById('overlayOpacityVal');
  if (label) label.textContent = Math.round(opacity * 100) + '%';

  if (currentGeoPdfLayer) currentGeoPdfLayer.setOpacity(opacity);
  if (typeof currentGeoTiffLayer !== 'undefined' && currentGeoTiffLayer) currentGeoTiffLayer.setOpacity(opacity);
  if (typeof customOverlayLayer !== 'undefined' && customOverlayLayer) customOverlayLayer.setOpacity(opacity);
}

function nudgeOverlay(dirX, dirY) {
  const step = parseFloat(document.getElementById('nudgeStep')?.value || '0.0005');

  overlayLonOffset += dirX * step;
  overlayLatOffset += dirY * step;

  localStorage.setItem(`overlayOffset_${activeProjectId}`, JSON.stringify({
    lat: overlayLatOffset,
    lon: overlayLonOffset
  }));

  applyNudgedBounds();
}

function applyNudgedBounds() {
  if (!activeOverlayBounds) return;

  const nudgedBounds = [
    [activeOverlayBounds[0][0] + overlayLatOffset, activeOverlayBounds[0][1] + overlayLonOffset],
    [activeOverlayBounds[1][0] + overlayLatOffset, activeOverlayBounds[1][1] + overlayLonOffset]
  ];

  if (currentGeoPdfLayer && mapInstance) {
    if (currentGeoPdfLayer.reposition && currentQuadCorners) {
      // Rotated Quad Support
      const tl = L.latLng(currentQuadCorners.topLeft.lat + overlayLatOffset, currentQuadCorners.topLeft.lng + overlayLonOffset);
      const tr = L.latLng(currentQuadCorners.topRight.lat + overlayLatOffset, currentQuadCorners.topRight.lng + overlayLonOffset);
      const bl = L.latLng(currentQuadCorners.bottomLeft.lat + overlayLatOffset, currentQuadCorners.bottomLeft.lng + overlayLonOffset);
      currentGeoPdfLayer.reposition(tl, tr, bl);
    } else if (currentGeoPdfLayer.setBounds) {
      currentGeoPdfLayer.setBounds(nudgedBounds);
    }
  }

  if (typeof customOverlayLayer !== 'undefined' && customOverlayLayer && mapInstance) {
    customOverlayLayer.setBounds(nudgedBounds);
  }

  const metersN = Math.round(overlayLatOffset * 111139);
  const metersE = Math.round(overlayLonOffset * (111139 * Math.cos(nudgedBounds[0][0] * Math.PI / 180)));
  const display = document.getElementById('nudgeOffsetDisplay');
  if (display) {
    display.textContent = `ΔN: ${metersN >= 0 ? '+' : ''}${metersN}m | ΔE: ${metersE >= 0 ? '+' : ''}${metersE}m`;
  }
}

function resetOverlayNudge() {
  overlayLatOffset = 0;
  overlayLonOffset = 0;
  localStorage.removeItem(`overlayOffset_${activeProjectId}`);
  applyNudgedBounds();
}

function makeNudgeHudDraggable() {
  const hud = document.getElementById('overlayNudgeControls');
  const handle = document.getElementById('nudgeDragHandle');
  if (!hud || !handle) return;

  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  function onPointerDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;

    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    startX = clientX;
    startY = clientY;

    const rect = hud.getBoundingClientRect();
    const parentRect = hud.offsetParent ? hud.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };

    initialLeft = rect.left - parentRect.left;
    initialTop = rect.top - parentRect.top;

    hud.style.transform = 'none';
    hud.style.left = `${initialLeft}px`;
    hud.style.top = `${initialTop}px`;

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = clientX - startX;
    const dy = clientY - startY;

    hud.style.left = `${initialLeft + dx}px`;
    hud.style.top = `${initialTop + dy}px`;
  }

  function onPointerUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
  }

  handle.addEventListener('mousedown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: true });
}

// ==========================================
// MAIN GEOPDF RENDERER PIPELINE
// ==========================================
async function loadGeoPDFOverlay() {
  const fileInput = document.getElementById('geopdfFileInput');
  const file = fileInput ? fileInput.files[0] : null;
  const statusEl = document.getElementById('pdfLoadingStatus');
  const renderBtn = document.getElementById('renderPdfBtn');

  if (!file) { alert("Please select a GeoPDF (.pdf) file first."); return; }
  if (!mapInstance) { alert("Please open the field map first."); return; }
  if (typeof pdfjsLib === 'undefined') { alert("PDF.js engine is still loading."); return; }

  const pdfBlobUrl = URL.createObjectURL(file);

  try {
    if (statusEl) statusEl.textContent = 'Reading GeoPDF metadata...';
    if (renderBtn) renderBtn.disabled = true;

    const loadingTask = pdfjsLib.getDocument(pdfBlobUrl);
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const mediaBox = page.view; // [0, 0, width, height]

    let pageTransform = null;
    let calculatedLeafletBounds = null;

    // Method 1: Scan for /BBox and /GPTS tags
    const meta = await pdfDoc.getMetadata().catch(() => ({}));
    const metaStr = JSON.stringify(meta.info || {});

    const bboxMatch = metaStr.match(/\/BBox\s*\[\s*([0-9.,\s-]+)\s*\]/i);
    const gptsMatch = metaStr.match(/\/GPTS\s*\[\s*([0-9.,\s-]+)\s*\]/i);

    if (bboxMatch && gptsMatch) {
      const bbox = bboxMatch[1].trim().split(/[\s,]+/).map(Number);
      const gpts = gptsMatch[1].trim().split(/[\s,]+/).map(Number);

      if (bbox.length === 4 && gpts.length >= 8) {
        if (statusEl) statusEl.textContent = 'Solving true affine transformation...';
        pageTransform = calculatePageWorldBounds(mediaBox, bbox, gpts, metaStr);
        if (pageTransform) {
          calculatedLeafletBounds = pageTransform.leafletBounds;
          currentQuadCorners = pageTransform.corners;
        }
      }
    }

    // Method 2: Fallback to text layer graticules
    if (!calculatedLeafletBounds) {
      if (statusEl) statusEl.textContent = 'Scanning graticules...';
      const neatlineBounds = await extractBoundsFromPageText(page);

      if (neatlineBounds) {
        const latSpan = neatlineBounds[1][0] - neatlineBounds[0][0];
        const lonSpan = neatlineBounds[1][1] - neatlineBounds[0][1];

        // Standard Toposheet neatline margin ratio
        calculatedLeafletBounds = [
          [neatlineBounds[0][0] - (latSpan * 0.22), neatlineBounds[0][1] - (lonSpan * 0.035)],
          [neatlineBounds[1][0] + (latSpan * 0.04), neatlineBounds[1][1] + (lonSpan * 0.035)]
        ];
      }
    }

    // Method 3: Default fallback for Chaupal Block-II
    if (!calculatedLeafletBounds) {
      const promptCoords = prompt(
        "Notice: Geospatial tags not automatically detected.\nEnter Neatline Coordinates (MinLat, MinLon, MaxLat, MaxLon):",
        "30.833333, 77.516667, 30.983333, 77.750000"
      );
      if (promptCoords) {
        const p = promptCoords.split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(n => !isNaN(n))) {
          const latSpan = p[2] - p[0];
          const lonSpan = p[3] - p[1];
          calculatedLeafletBounds = [
            [p[0] - (latSpan * 0.22), p[1] - (lonSpan * 0.035)],
            [p[2] + (latSpan * 0.04), p[3] + (lonSpan * 0.035)]
          ];
        }
      }
    }

    if (!calculatedLeafletBounds) {
      if (statusEl) statusEl.textContent = '';
      if (renderBtn) renderBtn.disabled = false;
      URL.revokeObjectURL(pdfBlobUrl);
      alert("Could not register spatial bounds.");
      return;
    }

    if (statusEl) statusEl.textContent = 'Rasterizing high-res sheet...';

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    URL.revokeObjectURL(pdfBlobUrl);

    canvas.toBlob(blob => {
      removeGeoPDFOverlay(false);

      currentGeoPdfBlobUrl = URL.createObjectURL(blob);

      // Check if Leaflet.ImageOverlay.Rotated is available for true quad fitting
      if (L.imageOverlay.rotated && currentQuadCorners) {
        currentGeoPdfLayer = L.imageOverlay.rotated(
          currentGeoPdfBlobUrl,
          currentQuadCorners.topLeft,
          currentQuadCorners.topRight,
          currentQuadCorners.bottomLeft,
          {
            opacity: 0.85,
            interactive: true
          }
        ).addTo(mapInstance);
      } else {
        // Standard axis-aligned rectangle fallback
        currentGeoPdfLayer = L.imageOverlay(currentGeoPdfBlobUrl, calculatedLeafletBounds, {
          opacity: 0.85,
          interactive: true
        }).addTo(mapInstance);
      }

      mapInstance.fitBounds(calculatedLeafletBounds);
      showNudgeControls(calculatedLeafletBounds);

      if (statusEl) statusEl.textContent = 'Ready (Avenza Quad Model)';
      if (renderBtn) renderBtn.disabled = false;
    }, 'image/png');

  } catch (err) {
    URL.revokeObjectURL(pdfBlobUrl);
    if (statusEl) statusEl.textContent = '';
    if (renderBtn) renderBtn.disabled = false;
    alert("GeoPDF Load Error: " + err.message);
  }
}

function removeGeoPDFOverlay(showAlert = true) {
  if (currentGeoPdfLayer && mapInstance) {
    mapInstance.removeLayer(currentGeoPdfLayer);
    currentGeoPdfLayer = null;
  }
  if (currentGeoPdfBlobUrl) {
    URL.revokeObjectURL(currentGeoPdfBlobUrl);
    currentGeoPdfBlobUrl = null;
  }
  currentQuadCorners = null;
  const fileInput = document.getElementById('geopdfFileInput');
  if (fileInput) fileInput.value = '';
  const statusEl = document.getElementById('pdfLoadingStatus');
  if (statusEl) statusEl.textContent = '';
  const nudgeBar = document.getElementById('overlayNudgeControls');
  if (nudgeBar) nudgeBar.style.display = 'none';
  if (showAlert) alert("GeoPDF map sheet removed.");
}
