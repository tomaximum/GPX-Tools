/**
 * GPX Smart Diff - Geospatial Engine (Turf.js) Optimized
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
                // ABSOLUTE MODE: String identity matching
                results.new = getAbsoluteDifference(lineB, lineA);
                results.deleted = getAbsoluteDifference(lineA, lineB);
                results.common = getAbsoluteIntersection(lineB, lineA);
            } else {
                // SMART MODE: Fuzzy distance matching
                const simplifiedA = turf.simplify(lineA, { tolerance: 0.001, highQuality: false });
                const simplifiedB = turf.simplify(lineB, { tolerance: 0.001, highQuality: false });

                results.new = getDifferenceOptimized(lineB, simplifiedA, toleranceKm);
                results.deleted = getDifferenceOptimized(lineA, simplifiedB, toleranceKm);
                results.common = getIntersectionOptimized(lineB, simplifiedA, toleranceKm);
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
    const lines = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
    if (lines.length === 0) return null;
    if (lines.length === 1) return lines[0];
    const coords = lines.flatMap(l => l.geometry.coordinates);
    return turf.lineString(coords);
}

/**
 * ABSOLUTE: High-performance identity matching using Sets
 */
function getAbsoluteDifference(lineTarget, lineReference) {
    const refSet = new Set(lineReference.geometry.coordinates.map(c => c.join(',')));
    const segments = [];
    let currentSegment = [];

    lineTarget.geometry.coordinates.forEach((coord) => {
        const key = coord.join(',');
        if (!refSet.has(key)) {
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
    const refSet = new Set(lineReference.geometry.coordinates.map(c => c.join(',')));
    const segments = [];
    let currentSegment = [];

    lineTarget.geometry.coordinates.forEach((coord) => {
        const key = coord.join(',');
        if (refSet.has(key)) {
            currentSegment.push(coord);
        } else {
            if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    return segments.length > 0 ? turf.featureCollection(segments) : null;
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
