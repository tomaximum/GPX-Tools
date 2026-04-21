/**
 * GPX Smart Diff - Geospatial Engine (Turf.js)
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
        // Prepare LineStrings
        const lineA = extractMainLine(traceA);
        const lineB = extractMainLine(traceB);

        if (lineA && lineB) {
            // New segments (Parts of B not in A)
            results.new = getDifference(lineB, lineA, toleranceKm);
            
            // Deleted segments (Parts of A not in B)
            results.deleted = getDifference(lineA, lineB, toleranceKm);
            
            // Common segments (Parts of B that are in A)
            results.common = getIntersection(lineB, lineA, toleranceKm);
        }
    }

    if (options.analyzeWpts) {
        const wptsA = traceA.features.filter(f => f.geometry.type === 'Point');
        const wptsB = traceB.features.filter(f => f.geometry.type === 'Point');

        if (wptsB.length > 0 || wptsA.length > 0) {
            results.waypoints = comparePoints(wptsA, wptsB, toleranceKm);
            
            // Merge with track results for export buttons
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

function comparePoints(wptsA, wptsB, toleranceKm) {
    const res = {
        new: turf.featureCollection([]),
        deleted: turf.featureCollection([]),
        common: turf.featureCollection([])
    };

    // Find New and Common in B
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

    // Find Deleted in A
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

function extractMainLine(geojson) {
    const lines = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
    if (lines.length === 0) return null;
    
    // Combine if multiple lines
    if (lines.length === 1) return lines[0];
    
    const coords = lines.flatMap(l => l.geometry.coordinates);
    return turf.lineString(coords);
}

/**
 * Returns segments of lineTarget that are NOT within tolerance of lineReference
 */
function getDifference(lineTarget, lineReference, toleranceKm) {
    const buffer = turf.buffer(lineReference, toleranceKm, { units: 'kilometers' });
    
    // Turf.lineSplit + filtering is often buggy with complex lines.
    // Better: Point-based segmentation.
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const isInside = turf.booleanPointInPolygon(pt, buffer);
        
        if (!isInside) {
            currentSegment.push(pt.geometry.coordinates);
        } else {
            if (currentSegment.length > 1) {
                segments.push(turf.lineString(currentSegment));
            }
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}

/**
 * Returns segments of lineTarget that ARE within tolerance of lineReference
 */
function getIntersection(lineTarget, lineReference, toleranceKm) {
    const buffer = turf.buffer(lineReference, toleranceKm, { units: 'kilometers' });
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const isInside = turf.booleanPointInPolygon(pt, buffer);
        
        if (isInside) {
            currentSegment.push(pt.geometry.coordinates);
        } else {
            if (currentSegment.length > 1) {
                segments.push(turf.lineString(currentSegment));
            }
            currentSegment = [];
        }
    });

    if (currentSegment.length > 1) segments.push(turf.lineString(currentSegment));
    
    return segments.length > 0 ? turf.featureCollection(segments) : null;
}
