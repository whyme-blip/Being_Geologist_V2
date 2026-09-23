Offline Structural Data Logger (GeoLogger v2)A client-side, offline-first Progressive Web Application (PWA) 
tailored for field geologists conducting structural mapping, traverse recording, and mineral exploration.
The application automates structural calculations, GPS logging, sample tracking, raster/vector overlays,
and GIS data exports entirely within the browser without requiring remote server infrastructure or cloud connectivity.  
Key Capabilities & Features1. Spatial & Geodetic FixesIntegrated GPS Acquisition: Inline geolocation fix directly alongside coordinates, elevation, and accuracy readout.  
Traverse Breadcrumb Tracking: Live background GPS tracking with real-time distance accumulation in kilometers.   Station Numbering Sequences:
Automatic location counter tracking with customizable project prefixes and manual override capabilities. 
2. Structural Geology EnginePlanar Data (RHR): Strike, Dip, and automatic Dip Direction calculation with quadrant classification.  
Linear Data: Trend and Plunge recording.   Pitch/Rake Calculator: Computes true Trend and Plunge from apparent rake angles along
inclined strike planes:$$\sin(\text{plunge}) = \sin(\text{dip}) \times \sin(\text{rake})$$$$\beta = \arctan\left(\tan(\text{rake}) \times \cos(\text{dip})\right)$$Dynamic Cartographic Symbology:
Renders rotated, publication-grade SVG planar (strike line + dip tick) and linear (trend arrow + plunge angle) markers dynamically on the map.  
3. Sampling & Field ObservationsExploration Sample Logging: Checkbox-activated sample tracker with sequence counter and sampling classification 
(Bed Rock, Petrochemical, Channel, Chip, Stream Sediment, Core, Heavy Mineral Concentrate).   Voice-to-Text Synthesis: Web Speech API integration 
for field hands-free remarks and microstructural descriptions.   Photo Tagging: Quick image tagging and camera attachment binding.  
4. Interactive Field Map & Spatial OverlaysLeaflet OSM Base: Cached offline tile access via Cache API.   In-Map Station Editing: 
Click any station marker popup to open an in-place editor to update lithology, structural attitude, or outcrop notes directly from the map.   
Scanned Map Overlays: Georeference scanned toposheets, geological field maps, or aerial photos via southwest and northeast bounding box limits (L.imageOverlay).   
Vector KML Layering: Ingest external .kml boundary lines, waypoints, and lease/block geofences with automatic bounding zooms. 
5. Data Security, Sharing & GIS Export50-Second Countdown Protection: Deletion of selected stations is guarded by an irreversible warning dialog and
a non-skippable 50-second safety lockout timer.1-Tap WhatsApp / App Sharing: Web Share API integration to dispatch field CSV files directly into WhatsApp chats, 
Google Drive, or email.Offline Database Backup: Instant JSON snapshot dump and restore to safeguard records against browser cache wipes or battery depletion.
GIS Interoperability: Native export to CSV, Google Earth KML (with structured HTML balloon descriptions), and GeoJSON for direct import into QGIS or ArcGIS.  
File ArchitecturePlaintext├── index.html       # Single-page user interface, modals, forms, and responsive styles
├── app.js           # Structural math engine, Leaflet mapping logic, PWA storage, and exports[cite: 1]
├── manifest.json    # PWA install metadata, stand-alone display settings, and icon mappings[cite: 3]
├── sw.js            # Service Worker script managing offline asset caching and OSM tile caching
├── icon-192.png     # Application launcher icon (192x192 px)[cite: 3, 4]
└── icon-512.png     # Splash screen icon (512x512 px)[cite: 3, 4]
Local Setup & DeploymentClone or Host the Repository:
Place the files in any static web hosting directory (such as GitHub Pages, Netlify, or a local server)[cite: 4].HTTPS Requirement:
Modern mobile browsers (Chrome, Safari, Firefox) restrict navigator.geolocation and navigator.share on non-secure origins.
The app must be served over HTTPS (or http://localhost during desktop testing).  
PWA Installation:Android (Chrome): Tap the browser menu ⋮ $\rightarrow$ Install app or Add to Home screen.iOS (Safari):
Tap the Share button $\rightarrow$ Add to Home Screen.   Usage WorkflowSelect or Create a Project: Pick an existing project or enter a new identifier at the top
(e.g., JAUNSAR-2026).   Arrive at Outcrop:Tap 📡 Sync GPS Fix inside Section 1 to lock latitude, longitude, and elevation.   Fill in lithology, unit/formation, 
and structure type.   If planar, enter Strike and Dip (Dip Direction is auto-computed).   If an associated lineation exists on the surface, click ➕ Associated Lineation 
and enter the pitch/rake angle.   Save Record: Tap the primary 💾 Save Record button.   Inspect on Map: Click 🗺️ View Field Map & Traverse at the top to view rotated
structural symbols, geofences, and the active GPS traverse route.   End-of-Day Backup: Use 💾 Save DB to download a raw database backup locally, and 📲 Share (WhatsApp)
to forward your daily CSV traverse file to camp[cite: 2].
