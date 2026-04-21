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
                results.new = getAbsoluteDifference(lineB, lineA);
                results.deleted = getAbsoluteDifference(lineA, lineB);
                results.common = getAbsoluteIntersection(lineB, lineA);
            } else {
                // IMPORTANT: Use higher precision for reference to avoid jitter
                const simplifiedA = turf.simplify(lineA, { tolerance: 0.0005, highQuality: true });
                const simplifiedB = turf.simplify(lineB, { tolerance: 0.0005, highQuality: true });

                results.new = cleanSegments(getDifferenceOptimized(lineB, simplifiedA, toleranceKm));
                results.deleted = cleanSegments(getDifferenceOptimized(lineA, simplifiedB, toleranceKm));
                results.common = cleanSegments(getIntersectionOptimized(lineB, simplifiedA, toleranceKm));
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
 * FIX: Preserve segments using MultiLineString instead of flatMap
 * This prevents "ghost lines" between disconnected segments.
 */
function extractMainLine(geojson) {
    const lines = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
    if (lines.length === 0) return null;
    if (lines.length === 1) return lines[0];

    // Combine all coordinates into a MultiLineString to preserve gaps
    const allCoords = lines.map(f => {
        if (f.geometry.type === 'LineString') return f.geometry.coordinates;
        return f.geometry.coordinates; // MultiLineString already nested, simplify here
    }).flat(1);
    
    // We want a MultiLineString where each entry is a valid LineString coord array
    return turf.multiLineString(lines.map(f => {
        if (f.geometry.type === 'LineString') return f.geometry.coordinates;
        return f.geometry.coordinates; 
    }).flat(f => f.geometry.type === 'MultiLineString' ? 0 : 1)); // Handle potential nesting
}

// Robust MultiLineString extraction
function getReferenceLines(geojson) {
    const features = geojson.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
    const coords = [];
    features.forEach(f => {
        if (f.geometry.type === 'LineString') coords.push(f.geometry.coordinates);
        else f.geometry.coordinates.forEach(c => coords.push(c));
    });
    return turf.multiLineString(coords);
}

/**
 * Filter tiny segments (noise) and smooth results
 */
function cleanSegments(featureCollection) {
    if (!featureCollection) return null;
    const MIN_LENGTH_KM = 0.03; // 30 meters
    
    const validFeatures = featureCollection.features.filter(f => {
        const len = turf.length(f, { units: 'kilometers' });
        return len > MIN_LENGTH_KM;
    });

    return validFeatures.length > 0 ? turf.featureCollection(validFeatures) : null;
}

function getAbsoluteDifference(lineTarget, lineReference) {
    const refCoords = lineReference.geometry.type === 'MultiLineString' 
        ? lineReference.geometry.coordinates.flat(1) 
        : lineReference.geometry.coordinates;
    const refSet = new Set(refCoords.map(c => c.join(',')));
    
    const segments = [];
    const targetCoords = lineTarget.geometry.type === 'MultiLineString' 
        ? lineTarget.geometry.coordinates.flat(1) 
        : lineTarget.geometry.coordinates;

    let currentSegment = [];
    targetCoords.forEach((coord) => {
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
    const refCoords = lineReference.geometry.type === 'MultiLineString' 
        ? lineReference.geometry.coordinates.flat(1) 
        : lineReference.geometry.coordinates;
    const refSet = new Set(refCoords.map(c => c.join(',')));
    
    const segments = [];
    const targetCoords = lineTarget.geometry.type === 'MultiLineString' 
        ? lineTarget.geometry.coordinates.flat(1) 
        : lineTarget.geometry.coordinates;

    let currentSegment = [];
    targetCoords.forEach((coord) => {
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
    const refLine = getReferenceLines(lineReference);
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const dist = turf.pointToLineDistance(pt, refLine, { units: 'kilometers' });
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
    const refLine = getReferenceLines(lineReference);
    const points = turf.explode(lineTarget);
    const segments = [];
    let currentSegment = [];

    points.features.forEach((pt) => {
        const dist = turf.pointToLineDistance(pt, refLine, { units: 'kilometers' });
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
