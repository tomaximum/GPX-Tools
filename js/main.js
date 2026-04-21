/**
 * GPX Smart Diff - Main Interaction Module
 */

import { compareGPX } from './engine.js';
import { exportGPX } from './exporter.js';

let map, activeLayers = {};
let traceA = null, traceB = null;
let segmentsA = [], segmentsB = [];
let diffData = null;
let hoverLayer = null;

const UI = {
    dropA: document.getElementById('drop-a'),
    dropB: document.getElementById('drop-b'),
    listA: document.getElementById('list-a'),
    listB: document.getElementById('list-b'),
    fileA: document.getElementById('file-a'),
    fileB: document.getElementById('file-b'),
    tolerance: document.getElementById('tolerance'),
    tolVal: document.getElementById('tol-val'),
    toggleTracks: document.getElementById('toggle-tracks'),
    toggleWpt: document.getElementById('toggle-waypoints'),
    toggleAbs: document.getElementById('toggle-absolute'),
    tolBox: document.getElementById('tolerance-box'),
    btnNew: document.getElementById('exp-new'),
    btnDel: document.getElementById('exp-del'),
    btnCom: document.getElementById('exp-com'),
    btnRun: document.getElementById('btn-run'),
    mobileToggle: document.getElementById('mobile-toggle'),
    sidebar: document.getElementById('sidebar'),
    statsCard: document.getElementById('stats-card'),
    statA: document.getElementById('stat-dist-a'),
    statB: document.getElementById('stat-dist-b')
};

// --- Initialization ---
function init() {
    initMap();
    initListeners();
}

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([46.603354, 1.888334], 6); // France center

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });

    osm.addTo(map); // Default

    const baseMaps = {
        "OpenStreetMap": osm,
        "Satellite": satellite,
        "Topographe": topo
    };

    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function initListeners() {
    // Drop Zones
    [UI.dropA, UI.dropB].forEach((zone, idx) => {
        zone.addEventListener('click', () => (idx === 0 ? UI.fileA : UI.fileB).click());
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('active'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('active');
            handleFile(e.dataTransfer.files[0], idx === 0 ? 'A' : 'B');
        });
    });

    UI.fileA.addEventListener('change', (e) => handleFile(e.target.files[0], 'A'));
    UI.fileB.addEventListener('change', (e) => handleFile(e.target.files[0], 'B'));

    // Manual Run Button
    UI.btnRun.addEventListener('click', runAnalysis);
    UI.btnRun.disabled = true;

    // Controls
    UI.tolerance.addEventListener('input', (e) => {
        UI.tolVal.innerText = e.target.value + 'm';
    });

    UI.toggleAbs.addEventListener('change', (e) => {
        UI.tolBox.style.opacity = e.target.checked ? '0.3' : '1';
        UI.tolBox.style.pointerEvents = e.target.checked ? 'none' : 'auto';
    });

    // Export
    UI.btnNew.addEventListener('click', () => exportGPX(diffData.new, 'new_segments'));
    UI.btnDel.addEventListener('click', () => exportGPX(diffData.deleted, 'deleted_segments'));
    UI.btnCom.addEventListener('click', () => exportGPX(diffData.common, 'common_segments'));

    // Mobile
    UI.mobileToggle.addEventListener('click', () => {
        UI.sidebar.classList.toggle('open');
    });
}

// --- Logic ---
async function handleFile(file, type) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const dom = new DOMParser().parseFromString(text, 'text/xml');
        const geojson = toGeoJSON.gpx(dom);
        
        const lines = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
        const processedSegments = lines.map((f, i) => ({
            id: i,
            name: f.properties.name || `Segment ${i + 1}`,
            distance: turf.length(f, { units: 'kilometers' }).toFixed(1),
            feature: f,
            selected: false
        }));

        if (type === 'A') {
            traceA = geojson;
            segmentsA = processedSegments;
            renderSegments(UI.listA, segmentsA, 'A');
            UI.dropA.querySelector('span').innerText = file.name;
            UI.dropA.classList.add('active');
        } else {
            traceB = geojson;
            segmentsB = processedSegments;
            renderSegments(UI.listB, segmentsB, 'B');
            UI.dropB.querySelector('span').innerText = file.name;
            UI.dropB.classList.add('active');
        }

        smartAutoPair();
        UI.btnRun.disabled = !(traceA && traceB);
    };
    reader.readAsText(file);
}

function renderSegments(container, segments, type) {
    container.innerHTML = '';
    segments.forEach(seg => {
        const card = document.createElement('div');
        card.className = `segment-card ${seg.selected ? 'selected' : ''}`;
        card.innerHTML = `
            <input type="checkbox" ${seg.selected ? 'checked' : ''}>
            <div class="seg-info">
                <span class="seg-name">${seg.name}</span>
                <span class="seg-dist">${seg.distance} km</span>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = card.querySelector('input');
                cb.checked = !cb.checked;
            }
            seg.selected = card.querySelector('input').checked;
            card.classList.toggle('selected', seg.selected);
        });

        card.addEventListener('mouseenter', () => highlightOnMap(seg.feature));
        card.addEventListener('mouseleave', () => clearHighlight());

        container.appendChild(card);
    });
}

function highlightOnMap(feature) {
    clearHighlight();
    hoverLayer = L.geoJSON(feature, {
        style: { color: '#3498db', weight: 8, opacity: 0.6 }
    }).addTo(map);
}

function clearHighlight() {
    if (hoverLayer) {
        map.removeLayer(hoverLayer);
        hoverLayer = null;
    }
}

function smartAutoPair() {
    if (segmentsA.length === 0 || segmentsB.length === 0) return;

    // Default: select first of each if nothing selected
    if (!segmentsA.some(s => s.selected)) {
        segmentsA[0].selected = true;
        renderSegments(UI.listA, segmentsA, 'A');
    }
    
    if (!segmentsB.some(s => s.selected)) {
        // Try to match name or index
        const firstA = segmentsA.find(s => s.selected);
        let match = segmentsB.find(s => s.name === firstA.name);
        if (!match && segmentsB[firstA.id]) match = segmentsB[firstA.id];
        if (!match) match = segmentsB[0];
        
        match.selected = true;
        renderSegments(UI.listB, segmentsB, 'B');
    }
}

async function runAnalysis() {
    const selectedA = segmentsA.filter(s => s.selected).map(s => s.feature);
    const selectedB = segmentsB.filter(s => s.selected).map(s => s.feature);

    if (selectedA.length === 0 || selectedB.length === 0) {
        alert("Veuillez sélectionner au moins un segment dans chaque trace.");
        return;
    }

    UI.sidebar.classList.add('is-loading');
    
    setTimeout(() => {
        const options = {
            tolerance: parseInt(UI.tolerance.value),
            analyzeTracks: UI.toggleTracks.checked,
            analyzeWpts: UI.toggleWpt.checked,
            absoluteMode: UI.toggleAbs.checked
        };

        try {
            // Prepare merged features for comparison (as requested)
            const collectionA = turf.featureCollection([...selectedA, ...traceA.features.filter(f => f.geometry.type === 'Point')]);
            const collectionB = turf.featureCollection([...selectedB, ...traceB.features.filter(f => f.geometry.type === 'Point')]);

            diffData = compareGPX(collectionA, collectionB, options);
            renderOnMap(diffData);
            updateStats(collectionA, collectionB);

            UI.btnNew.disabled = !(diffData && diffData.new);
            UI.btnDel.disabled = !(diffData && diffData.deleted);
            UI.btnCom.disabled = !(diffData && diffData.common);
        } catch (e) {
            console.error("Analysis failed", e);
        } finally {
            UI.sidebar.classList.remove('is-loading');
        }
    }, 50);
}

function renderOnMap(data) {
    Object.values(activeLayers).forEach(l => map.removeLayer(l));
    activeLayers = {};

    const styles = {
        common: { color: '#95a5a6', weight: 2, opacity: 0.4 },
        new: { color: '#2ecc71', weight: 6, opacity: 1 },
        deleted: { color: '#e74c3c', weight: 6, opacity: 1 }
    };

    const pointStyle = (color) => ({ radius: 6, fillColor: color, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.8 });

    if (data.common) activeLayers.common = L.geoJSON(data.common, { 
        style: styles.common,
        pointToLayer: (f, latlng) => L.circleMarker(latlng, pointStyle(styles.common.color))
    }).addTo(map);

    if (data.new) activeLayers.new = L.geoJSON(data.new, { 
        style: styles.new,
        pointToLayer: (f, latlng) => L.circleMarker(latlng, pointStyle(styles.new.color))
    }).addTo(map);

    if (data.deleted) {
        activeLayers.deleted = L.geoJSON(data.deleted, { 
            style: styles.deleted,
            pointToLayer: (f, latlng) => L.circleMarker(latlng, pointStyle(styles.deleted.color))
        }).addTo(map).bringToFront();
    }

    if (data.new) {
        activeLayers.new = L.geoJSON(data.new, { 
            style: styles.new,
            pointToLayer: (f, latlng) => L.circleMarker(latlng, pointStyle(styles.new.color))
        }).addTo(map).bringToFront();
    }

    const combined = L.featureGroup(Object.values(activeLayers));
    if (combined.getLayers().length > 0) {
        map.fitBounds(combined.getBounds(), { padding: [20, 20] });
    }
}

function updateStats(a, b) {
    const distA = turf.length(a, { units: 'kilometers' }).toFixed(1);
    const distB = turf.length(b, { units: 'kilometers' }).toFixed(1);
    UI.statA.innerText = distA + ' km';
    UI.statB.innerText = distB + ' km';
    UI.statsCard.style.display = 'grid';
}

init();
