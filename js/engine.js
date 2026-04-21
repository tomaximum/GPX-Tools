/**
 * GPX Smart Diff - Geospatial Engine (Turf.js) Optimized
 * VERSION 3.3.0 - Multi-Segment Geometry Fix
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
                results.new = getAbsoluteDifference(lineB, lineA);
                results.deleted = getAbsoluteDifference(lineA, lineB);
                results.common = getAbsoluteIntersection(lineB, lineA);
            } else {
                // Use raw lines for maximum precision, no simplify.
                results.new = cleanSegments(getDifferenceOptimized(lineB, lineA, toleranceKm));
                results.deleted = cleanSegments(getDifferenceOptimized(lineA, lineB, toleranceKm));
                results.common = cleanSegments(getIntersectionOptimized(lineB, lineA, toleranceKm));
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

/**
 * FIXED: Correct construction of MultiLineString coordinates
 */
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
 * Filter tiny segments (noise)
 */
function cleanSegments(featureCollection) {
    if (!featureCollection) return null;
    const MIN_LENGTH_KM = 0.005; // 5 meters (more permissive)
    
    const validFeatures = featureCollection.features.filter(f => {
        const len = turf.length(f, { units: 'kilometers' });
        return len > MIN_LENGTH_KM;
    });

    return validFeatures.length > 0 ? turf.featureCollection(validFeatures) : null;
}

function getAbsoluteDifference(lineTarget, lineReference) {
    const refCoords = getFlatCoords(lineReference);
    const refSet = new Set(refCoords.map(c => c.join(',')));
    const targetCoords = getFlatCoords(lineTarget);
    
    const segments = [];
    let currentSegment = [];

    targetCoords.forEach((coord) => {
        if (!refSet.has(coord.join(','))) {
            currentSegment.push(coord);
        } else {
            if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
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
    if (geometry.getGeom) geometry = geometry.getGeom(); // Handle feature vs geometry
    const geom = geometry.geometry || geometry;
    if (geom.type === 'LineString') return geom.coordinates;
    if (geom.type === 'MultiLineString') return geom.coordinates.flat(1);
    return [];
}

function getDifferenceOptimized(lineTarget, lineReference, toleranceKm) {
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const dist = turf.pointToLineDistance(pt, lineReference, { units: 'kilometers' });
        const isInside = dist <= toleranceKm;
        
        if (!isInside) {
            currentSegment.push(pt.geometry.coordinates);
        } else {
            if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

function getIntersectionOptimized(lineTarget, lineReference, toleranceKm) {
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const dist = turf.pointToLineDistance(pt, lineReference, { units: 'kilometers' });
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
