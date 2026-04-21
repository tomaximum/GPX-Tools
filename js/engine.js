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
            // Optimization: Simplify the reference lines for the distance calculation
            // This massively speeds up O(N*M) operations without losing much precision for diff
            const simplifiedA = turf.simplify(lineA, { tolerance: 0.001, highQuality: false }); // ~1m tolerance
            const simplifiedB = turf.simplify(lineB, { tolerance: 0.001, highQuality: false });

            // New segments (Parts of B not in A)
            results.new = getDifferenceOptimized(lineB, simplifiedA, toleranceKm);
            
            // Deleted segments (Parts of A not in B)
            results.deleted = getDifferenceOptimized(lineA, simplifiedB, toleranceKm);
            
            // Common segments (Parts of B that are in A)
            results.common = getIntersectionOptimized(lineB, simplifiedA, toleranceKm);
        }
    }

    if (options.analyzeWpts) {
        const wptsA = traceA.features.filter(f => f.geometry.type === 'Point');
        const wptsB = traceB.features.filter(f => f.geometry.type === 'Point');

        if (wptsB.length > 0 || wptsA.length > 0) {
            results.waypoints = comparePoints(wptsA, wptsB, toleranceKm);
            
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
 * Faster comparison using Point-to-Line distance instead of Buffer
 */
function getDifferenceOptimized(lineTarget, lineReference, toleranceKm) {
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        // Point To Line Distance is O(M)
        const dist = turf.pointToLineDistance(pt, lineReference, { units: 'kilometers' });
        const isInside = dist <= toleranceKm;
        
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
            if (currentSegment.length > 1) {
                segments.push(turf.lineString(currentSegment));
            }
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
