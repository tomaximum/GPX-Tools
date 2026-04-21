/**
 * GPX Smart Diff - Geospatial Engine (Turf.js) Optimized
 * VERSION 3.7.0 - Merge-First Logic (Fixes Disjointed Segments)
 */

export function compareGPX(traceA, traceB, options) {
    const results = {
        new: null,
        deleted: null,
        common: null,
        waypoints: null
    };

    const toleranceKm = options.tolerance / 1000;

    if (options.analyzeTracks) {
        const lineA = extractMainLine(traceA);
        const lineB = extractMainLine(traceB);

        if (lineA && lineB) {
            if (options.absoluteMode) {
                results.new = mergeAndCleanSegments(getAbsoluteDifference(lineB, lineA));
                results.deleted = mergeAndCleanSegments(getAbsoluteDifference(lineA, lineB));
                results.common = mergeAndCleanSegments(getAbsoluteIntersection(lineB, lineA));
            } else {
                results.new = mergeAndCleanSegments(getDifferenceOptimized(lineB, lineA, toleranceKm));
                results.deleted = mergeAndCleanSegments(getDifferenceOptimized(lineA, lineB, toleranceKm));
                results.common = mergeAndCleanSegments(getIntersectionOptimized(lineB, lineA, toleranceKm));
            }
        }
    }

    if (options.analyzeWpts) {
        const wptsA = traceA.features.filter(f => f.geometry.type === 'Point');
        const wptsB = traceB.features.filter(f => f.geometry.type === 'Point');

        if (wptsB.length > 0 || wptsA.length > 0) {
            results.waypoints = comparePoints(wptsA, wptsB, options.absoluteMode ? 0 : toleranceKm);
            
            if (results.new) results.new.features.push(...results.waypoints.new.features);
            else results.new = results.waypoints.new;

            if (results.deleted) results.deleted.features.push(...results.waypoints.deleted.features);
            else results.deleted = results.waypoints.deleted;

            if (results.common) results.common.features.push(...results.waypoints.common.features);
            else results.common = results.waypoints.common;
        }
    }

    return results;
}

function extractMainLine(geojson) {
    const features = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
    if (features.length === 0) return null;
    
    const coords = [];
    features.forEach(f => {
        if (f.geometry.type === 'LineString') {
            if (f.geometry.coordinates.length > 1) coords.push(f.geometry.coordinates);
        } else {
            f.geometry.coordinates.forEach(c => {
                if (c.length > 1) coords.push(c);
            });
        }
    });

    if (coords.length === 0) return null;
    if (coords.length === 1) return turf.lineString(coords[0]);
    return turf.multiLineString(coords);
}

/**
 * FIXED: Merge segments BEFORE cleaning tiny ones.
 * This ensures "suture" fragments aren't deleted before being attached.
 */
function mergeAndCleanSegments(featureCollection) {
    if (!featureCollection || featureCollection.features.length === 0) return null;
    
    const MIN_LENGTH_KM = 0.03; 
    const JOIN_DISTANCE_KM = 0.08; 

    const features = featureCollection.features;

    // 1. Greedy Merge FIRST
    const merged = [];
    let current = features[0];

    for (let i = 1; i < features.length; i++) {
        const next = features[i];
        const lastCoord = current.geometry.coordinates[current.geometry.coordinates.length - 1];
        const firstCoord = next.geometry.coordinates[0];
        const gap = turf.distance(lastCoord, firstCoord, { units: 'kilometers' });

        if (gap < JOIN_DISTANCE_KM) {
            const newCoords = [...current.geometry.coordinates, ...next.geometry.coordinates];
            current = turf.lineString(newCoords);
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);

    // 2. Clean tiny isolated fragments LAST
    const cleaned = merged.filter(f => {
        return turf.length(f, { units: 'kilometers' }) > MIN_LENGTH_KM;
    });

    return cleaned.length > 0 ? turf.featureCollection(cleaned) : null;
}

function getAbsoluteDifference(lineTarget, lineReference) {
    const refCoords = getFlatCoords(lineReference);
    const refSet = new Set(refCoords.map(c => c.join(',')));
    const targetCoords = getFlatCoords(lineTarget);
    const segments = [];
    let currentSegment = [];

    targetCoords.forEach((coord, i) => {
        if (!refSet.has(coord.join(','))) {
            if (currentSegment.length === 0 && i > 0) {
                currentSegment.push(targetCoords[i-1]);
            }
            currentSegment.push(coord);
        } else {
            if (currentSegment.length > 0) {
                currentSegment.push(coord);
                if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            }
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

function getAbsoluteIntersection(lineTarget, lineReference) {
    const refCoords = getFlatCoords(lineReference);
    const refSet = new Set(refCoords.map(c => c.join(',')));
    const targetCoords = getFlatCoords(lineTarget);
    const segments = [];
    let currentSegment = [];

    targetCoords.forEach((coord) => {
        if (refSet.has(coord.join(','))) {
            currentSegment.push(coord);
        } else {
            if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

function getFlatCoords(geometry) {
    const geom = geometry.geometry || geometry;
    if (geom.type === 'LineString') return geom.coordinates;
    if (geom.type === 'MultiLineString') return geom.coordinates.flat(1);
    return [];
}

function getDifferenceOptimized(lineTarget, lineReference, toleranceKm) {
    const refGeom = lineReference.geometry || lineReference;
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt, i) => {
        const dist = turf.pointToLineDistance(pt, refGeom, { units: 'kilometers' });
        const isInside = dist <= toleranceKm;
        
        if (!isInside) {
            if (currentSegment.length === 0 && i > 0) {
                currentSegment.push(points.features[i-1].geometry.coordinates);
            }
            currentSegment.push(pt.geometry.coordinates);
        } else {
            if (currentSegment.length > 0) {
                currentSegment.push(pt.geometry.coordinates);
                if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            }
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

function getIntersectionOptimized(lineTarget, lineReference, toleranceKm) {
    const refGeom = lineReference.geometry || lineReference;
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const dist = turf.pointToLineDistance(pt, refGeom, { units: 'kilometers' });
        const isInside = dist <= toleranceKm;
        
        if (isInside) {
            currentSegment.push(pt.geometry.coordinates);
        } else {
            if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

function comparePoints(wptsA, wptsB, toleranceKm) {
    const res = {
        new: turf.featureCollection([]),
        deleted: turf.featureCollection([]),
        common: turf.featureCollection([])
    };

    wptsB.forEach(pB => {
        let found = false;
        for (const pA of wptsA) {
            if (turf.distance(pB, pA, { units: 'kilometers' }) <= toleranceKm) {
                found = true;
                break;
            }
        }
        if (found) res.common.features.push(pB);
        else res.new.features.push(pB);
    });

    wptsA.forEach(pA => {
        let found = false;
        for (const pB of wptsB) {
            if (turf.distance(pA, pB, { units: 'kilometers' }) <= toleranceKm) {
                found = true;
                break;
            }
        }
        if (!found) res.deleted.features.push(pA);
    });

    return res;
}
