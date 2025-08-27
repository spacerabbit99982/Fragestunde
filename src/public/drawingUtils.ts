import { DrawingInfo, Dimension, Marker, ReferenceLine, CuttingPlan } from './types.js';

// --- Generic Drawing & Geometry Helper Functions ---

/**
 * Calculates stud positions and spacings for a given wall length.
 */
export const calculateStudLayout = (totalLength: number, studThickness: number, standardSpacing: number): { positions: number[], spacings: number[] } => {
    if (totalLength < studThickness * 2) return { positions: [studThickness / 2, totalLength - studThickness / 2], spacings: [totalLength - studThickness] };
    
    const positions: number[] = [studThickness / 2];
    let currentPos = studThickness / 2;
    const endPos = totalLength - studThickness / 2;

    while (currentPos + standardSpacing < endPos - standardSpacing / 2) {
        currentPos += standardSpacing;
        positions.push(currentPos);
    }
    
    positions.push(endPos);

    const spacings: number[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
        spacings.push(positions[i + 1] - positions[i]);
    }
    
    return { positions, spacings };
};


/**
 * Creates a DrawingInfo object from a set of points and metadata.
 */
export const getDrawingInfo = (points: {x:number, y:number}[], depth: number, dimensions?: Dimension[], markers?: Marker[], referenceLines?: ReferenceLine[]): DrawingInfo => {
    const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    points.forEach(p => {
        bbox.minX = Math.min(bbox.minX, p.x);
        bbox.maxX = Math.max(bbox.maxX, p.x);
        bbox.minY = Math.min(bbox.minY, p.y);
        bbox.maxY = Math.max(bbox.maxY, p.y);
    });
    return { points, bbox, depth, dimensions, markers, referenceLines };
};

/**
 * Creates DrawingInfo for a simple rectangular part.
 */
export const createBoxDrawingInfo = (length: number, height: number, depth: number, customDimensions: Dimension[] = [], markers: Marker[] = []): DrawingInfo => {
    const points = [
        { x: 0, y: 0 }, { x: length, y: 0 },
        { x: length, y: height }, { x: 0, y: height }
    ];
    const defaultDimensions: Dimension[] = [
        { type: 'linear_horizontal', p1: {x:0, y:height}, p2: {x:length, y:height}, offset: 40, label: `${(length * 100).toFixed(1)}cm` },
        { type: 'linear_vertical', p1: {x:0, y:0}, p2: {x:0, y:height}, offset: -40, label: `${(height * 100).toFixed(1)}cm` }
    ];
    return getDrawingInfo(points, depth, [...defaultDimensions, ...customDimensions], markers);
};

/**
 * Optimizes a list of cuts to fit onto stock pieces using a best-fit algorithm.
 */
export const optimizeCuttingList = (allCuts: number[], stockLength: number, kerf: number): { plan: CuttingPlan, summaryText: string } => {
    const sortedCuts = [...allCuts].sort((a, b) => b - a);
    const bins: number[][] = [];
    const remainingLengths: number[] = [];

    for (const cut of sortedCuts) {
        if (cut > stockLength) {
            console.warn(`Cut of ${cut}m is longer than stock of ${stockLength}m. Skipping.`);
            continue;
        }

        let placed = false;
        let bestFitIndex = -1;
        let minRemaining = Infinity;

        for (let i = 0; i < bins.length; i++) {
            if (remainingLengths[i] >= cut + kerf && remainingLengths[i] < minRemaining) {
                minRemaining = remainingLengths[i];
                bestFitIndex = i;
            }
        }
        
        if (bestFitIndex !== -1) {
            bins[bestFitIndex].push(cut);
            remainingLengths[bestFitIndex] -= (cut + kerf);
            placed = true;
        }

        if (!placed) {
            bins.push([cut]);
            remainingLengths.push(stockLength - cut - kerf);
        }
    }

    const cuttingPlanSummary: Record<string, { cuts: number[], count: number }> = {};
    for (const bin of bins) {
        const sortedBin = bin.sort((a, b) => b - a);
        const key = sortedBin.map(c => `${(c * 100).toFixed(1)}`).join(',');
        
        if (!cuttingPlanSummary[key]) {
            cuttingPlanSummary[key] = { cuts: sortedBin, count: 0 };
        }
        cuttingPlanSummary[key].count++;
    }
    
    const structuredBins = Object.values(cuttingPlanSummary);

    const summaryLines = structuredBins.map(binInfo => {
        const cutsText = binInfo.cuts.map(c => `${(c * 100).toFixed(1)}cm`).join(' + ');
        return `${binInfo.count}x 5m Stange: schneiden zu ${cutsText}`;
    });
    
    const summaryText = summaryLines.length > 0
        ? `Zuschnittplan (optimiert für 5m Stangen, inkl. ${kerf * 1000}mm Sägeschnitt):\n${summaryLines.join('\n')}`
        : '';
        
    return {
        plan: {
            stockLength,
            kerf,
            bins: structuredBins
        },
        summaryText
    };
};


// --- Carport Specific Drawing Functions ---

/**
 * Creates DrawingInfo for a 45-degree mitered brace.
 */
export const createMiteredBraceDrawingInfo = (schenkelLength: number, size: number): { drawingInfo: DrawingInfo, outerLength: number } => {
    if (schenkelLength <= 0.01) schenkelLength = 0.1; 
    const outerLength = Math.sqrt(2) * schenkelLength;

    const drawingPoints = [
        { x: size, y: 0 },
        { x: outerLength - size, y: 0 },
        { x: outerLength, y: size },
        { x: 0, y: size },
    ];
    
    const p_top_left_sharp = { x: 0, y: size };
    const p_top_right_sharp = { x: outerLength, y: size };
    
    const referenceLines: ReferenceLine[] = [];
    const dimensions: Dimension[] = [
        { type: 'linear_horizontal', p1: p_top_left_sharp, p2: p_top_right_sharp, offset: 45, label: `L: ${(outerLength * 100).toFixed(1)}cm` },
        { type: 'linear_vertical', p1: p_top_right_sharp, p2: {x: p_top_right_sharp.x, y: 0 }, offset: 45, label: `${(size*100).toFixed(1)}cm`},
    ];

    // Left cut dimensioning
    const center_left = p_top_left_sharp;
    const ref_line_vert_left_end = { x: center_left.x, y: 0 };
    const ref_line_miter_left_end = { x: size, y: 0 };
    referenceLines.push({ p1: center_left, p2: ref_line_vert_left_end, style: 'dashed' });
    referenceLines.push({ p1: center_left, p2: ref_line_miter_left_end, style: 'dashed' });
    dimensions.push({ type: 'angular', center: center_left, p1: { x: center_left.x, y: center_left.y - 1 }, p2: { x: center_left.x + 1, y: center_left.y - 1 }, radius: 25, label: '45°' });

    // Right cut dimensioning
    const center_right = p_top_right_sharp;
    const ref_line_vert_right_end = { x: center_right.x, y: 0 };
    const ref_line_miter_right_end = { x: outerLength - size, y: 0 };
    referenceLines.push({ p1: center_right, p2: ref_line_vert_right_end, style: 'dashed' });
    referenceLines.push({ p1: center_right, p2: ref_line_miter_right_end, style: 'dashed' });
    dimensions.push({ type: 'angular', center: center_right, p1: { x: center_right.x, y: center_right.y - 1 }, p2: { x: center_right.x - 1, y: center_right.y - 1 }, radius: 25, label: '45°' });
    
    return { drawingInfo: getDrawingInfo(drawingPoints, size, dimensions, [], referenceLines), outerLength: outerLength };
};

const createRafterDrawingInternal = (
    rawPoints: {x: number, y: number}[],
    keyPoints: any,
    RAFTER_W: number,
    RAFTER_H: number,
    roofPitch: number
): { drawingInfo: DrawingInfo, totalLength: number } => {
    
    // 1. Transform points to be aligned with the rafter's top edge for drawing.
    const pivot = { ...keyPoints.p_ridge_top };
    const topEdgeAngleRad = Math.atan2(keyPoints.p_tail_top.y - pivot.y, keyPoints.p_tail_top.x - pivot.x);
    const sinA_transform = Math.sin(-topEdgeAngleRad);
    const cosA_transform = Math.cos(-topEdgeAngleRad);

    const rotatePoint = (p: {x: number, y: number}) => {
        const dx = p.x - pivot.x;
        const dy = p.y - pivot.y;
        const rotatedX = dx * cosA_transform - dy * sinA_transform;
        const rotatedY = dx * sinA_transform + dy * cosA_transform;
        return { x: rotatedX, y: -rotatedY };
    };
    
    const drawingPolygon = rawPoints.map(rotatePoint);
    
    const dimensions: Dimension[] = [];
    const referenceLines: ReferenceLine[] = [];

    const addCutAngle = (
        cornerPoint: { x: number, y: number }, // in world coordinates
        angleLabel: string,
        options: {
            // All vectors are in drawing coordinates (+y is DOWN)
            line1_vec: { x: number, y: number },
            line2_vec: { x: number, y: number },
            radius?: number
        }
    ) => {
        const t_corner = rotatePoint(cornerPoint);
        const lineLen = 0.6;
        const radius = options.radius || 45;

        const p_ref1_end = { x: t_corner.x + options.line1_vec.x * lineLen, y: t_corner.y + options.line1_vec.y * lineLen };
        const p_ref2_end = { x: t_corner.x + options.line2_vec.x * lineLen, y: t_corner.y + options.line2_vec.y * lineLen };

        referenceLines.push({ p1: t_corner, p2: p_ref1_end, style: 'dashed' });
        referenceLines.push({ p1: t_corner, p2: p_ref2_end, style: 'dashed' });
        dimensions.push({ type: 'angular', center: t_corner, p1: p_ref1_end, p2: p_ref2_end, radius, label: angleLabel });
    };

    const addAlignedDimension = (p1_world: {x:number, y:number}, p2_world: {x:number, y:number}, offset: number, label: string) => {
        const t_p1 = rotatePoint(p1_world);
        const t_p2 = rotatePoint(p2_world);
        dimensions.push({ type: 'linear_aligned', p1: t_p1, p2: t_p2, offset: offset, label: label });
    };

    const rot = -topEdgeAngleRad;

    // DEUTSCH: Bemaßung der Firstkerbe (am Punkt p_ridge_notch_outer_top)
    addCutAngle(keyPoints.p_ridge_notch_outer_top, `${(90 - roofPitch).toFixed(1)}°`, {
        // Referenzlinie ist vertikal nach oben
        line1_vec: { x: 0, y: -1 },
        // Verlängerungslinie folgt dem Lotschnitt
        line2_vec: { x: Math.sin(rot), y: -Math.cos(rot)},
        radius: 70
    });
    
    // DEUTSCH: Bemaßung des Fussschnitts (am Punkt p_tail_top)
    addCutAngle(keyPoints.p_tail_top, `${(90 - roofPitch).toFixed(1)}°`, {
        // Referenzlinie ist vertikal nach unten
        line1_vec: { x: 0, y: 1 },
        // Verlängerungslinie folgt dem Lotschnitt nach links-unten
        line2_vec: { x: -Math.sin(rot), y: Math.cos(rot)}, 
        radius: 70
    });

    // --- START: Detaillierte Bemaßung der Fusskerbe ---
    // DEUTSCH: Zuerst definieren wir die Vektoren für die Verlängerungslinien der Schnitte in den 2D-Zeichnungskoordinaten.
    // In SVG-Koordinaten zeigt die positive Y-Achse nach unten, daher müssen Y-Werte für "nach oben" negativ sein.
    // Annahme: 'rot' ist ein negativer Winkel, basierend auf der Analyse des Benutzerfeedbacks.
    const plumbUpLeft = { x: Math.sin(rot), y: -Math.cos(rot) }; // Vektor für den Fersenschnitt (Lot), korrigiert, um nach links-oben zu zeigen.
    const seatUpRight = { x: Math.cos(rot), y: Math.sin(rot) }; // Vektor für den Kervenschnitt (Waage), korrigiert, um nach rechts-oben zu zeigen.

    // DEUTSCH: Bemaßung des Fersenschnitts (Lot).
    // DIESE HILFSLINIE WIRD GENERIERT: Winkel des Fersenschnitts am inneren Eckpunkt der Kerbe (p_heel_top).
    addCutAngle(keyPoints.p_heel_top, `${(90 - roofPitch).toFixed(1)}°`, {
        line1_vec: { x: 0, y: -1 }, // DIESE HILFSLINIE WIRD GENERIERT: Vertikale Referenzlinie nach oben.
        line2_vec: plumbUpLeft,      // DIESE HILFSLINIE WIRD GENERIERT: Verlängerungslinie des Fersenschnitts nach links-oben.
    });
    
    // DEUTSCH: Bemaßung des Kervenschnitts (Waage).
    // DIESE HILFSLINIE WIRD GENERIERT: Winkel des Kervenschnitts an der oberen, rechten Ecke der Kerbe (p_seat_inner).
    // Die Bemaßung gegen eine horizontale Linie ergibt direkt die Dachneigung und ist praxisüblich.
    addCutAngle(keyPoints.p_seat_inner, `${roofPitch.toFixed(1)}°`, {
        line1_vec: { x: 1, y: 0 },   // DIESE HILFSLINIE WIRD GENERIERT: Horizontale Referenzlinie nach rechts.
        line2_vec: seatUpRight,      // DIESE HILFSLINIE WIRD GENERIERT: Verlängerungslinie des Kervenschnitts nach rechts-oben.
    });

    // DEUTSCH: Explizite Darstellung des 90°-Winkels zwischen den beiden Schnitten.
    // DIESE HILFSLINIE WIRD GENERIERT: Der 90°-Winkel wird am geometrischen Schnittpunkt der Linien (p_heel_top) bemaßt.
    addCutAngle(keyPoints.p_heel_top, '90.0°', {
        line1_vec: plumbUpLeft,      // DIESE HILFSLINIE WIRD GENERIERT: Linie entlang des Fersenschnitts.
        line2_vec: seatUpRight,      // DIESE HILFSLINIE WIRD GENERIERT: Linie entlang des Kervenschnitts.
    });
    // --- ENDE: Detaillierte Bemaßung der Fusskerbe ---


    // --- Linear Dimensions ---
    addAlignedDimension(keyPoints.p_ridge_notch_inner, keyPoints.p_ridge_notch_outer_top, 40, `${(Math.abs(keyPoints.p_ridge_notch_outer_top.x - keyPoints.p_ridge_notch_inner.x)*100).toFixed(1)}cm`);
    addAlignedDimension(keyPoints.p_ridge_notch_outer_top, keyPoints.p_ridge_notch_outer_bottom, 40, `${(Math.abs(keyPoints.p_ridge_notch_outer_top.y - keyPoints.p_ridge_notch_outer_bottom.y)*100).toFixed(1)}cm`);
    
    addAlignedDimension(keyPoints.p_seat_inner, keyPoints.p_heel_top, 40, `${(Math.hypot(keyPoints.p_heel_top.x - keyPoints.p_seat_inner.x, keyPoints.p_heel_top.y - keyPoints.p_seat_inner.y)*100).toFixed(1)}cm`);
    addAlignedDimension(keyPoints.p_heel_top, keyPoints.p_heel_bottom, -40, `${(Math.hypot(keyPoints.p_heel_bottom.x - keyPoints.p_heel_top.x, keyPoints.p_heel_bottom.y - keyPoints.p_heel_top.y)*100).toFixed(1)}cm`);
    
    if (keyPoints.p_purlin_seat_start) {
        addAlignedDimension(keyPoints.p_purlin_seat_start, keyPoints.p_purlin_seat_end, 40, `${(Math.hypot(keyPoints.p_purlin_seat_end.x - keyPoints.p_purlin_seat_start.x, keyPoints.p_purlin_seat_end.y - keyPoints.p_purlin_seat_start.y)*100).toFixed(1)}cm`);
        addAlignedDimension(keyPoints.p_purlin_seat_start, keyPoints.p_purlin_plumb_start_bottom, -40, `${(Math.hypot(keyPoints.p_purlin_plumb_start_bottom.x - keyPoints.p_purlin_seat_start.x, keyPoints.p_purlin_plumb_start_bottom.y - keyPoints.p_purlin_seat_start.y)*100).toFixed(1)}cm`);
    }

    const totalLength = Math.hypot(keyPoints.p_tail_bottom.x - keyPoints.p_ridge_top.x, keyPoints.p_tail_bottom.y - keyPoints.p_ridge_top.y);
    dimensions.push({ type: 'linear_horizontal', p1: rotatePoint(keyPoints.p_ridge_top), p2: rotatePoint(keyPoints.p_tail_bottom), offset: -110, label: `Länge: ${(totalLength * 100).toFixed(1)}cm`});
    
    const drawingInfo = getDrawingInfo(drawingPolygon, RAFTER_W, dimensions, [], referenceLines);
    const finalBbox = drawingInfo.bbox;
    // FIX: Add null check before pushing to dimensions array
    if (!drawingInfo.dimensions) {
        drawingInfo.dimensions = [];
    }
    drawingInfo.dimensions.push( { type: 'linear_vertical', p1: { x: finalBbox.minX, y: finalBbox.minY }, p2: { x: finalBbox.minX, y: finalBbox.maxY }, offset: -55, label: `${(RAFTER_H * 100).toFixed(1)}cm` });

    return { drawingInfo, totalLength };
};

/**
 * Creates DrawingInfo for a Carport Satteldach (gable roof) rafter.
 */
export const createCarportSatteldachRafterDrawing = (
    W: number, BEAM_W: number, RAFTER_W: number, RAFTER_H: number, H: number, roofOverhang: number, roofPitch: number,
    middlePurlinInfo: {centerX: number, width: number, height: number, seatY: number} | null
): { drawingInfo: DrawingInfo, totalLength: number } => {
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const tanA = Math.tan(roofAngleRad);
    const cosA = Math.cos(roofAngleRad);
    const plateTopY = H;

    const sign = 1; // Calculate for right side
    const rafterSlopeHeight = RAFTER_H / cosA;
    const post_center_x = W / 2;
    const plateWidth = BEAM_W;
    const ridgeBeamHalfWidth = BEAM_W / 2;
    const x_ridge_plumb = 0, x_ridge_seat_outer = sign * ridgeBeamHalfWidth;
    const x_plate_outer = sign * (post_center_x + plateWidth / 2), x_plate_inner = sign * (post_center_x - plateWidth / 2);
    const x_tail_end = sign * (post_center_x + plateWidth / 2 + roofOverhang);
    
    const y_bottom_abs = (x_abs:number) => -tanA * (Math.abs(x_abs) - (post_center_x - plateWidth / 2)) + plateTopY;
    const y_top_abs = (x_abs:number) => y_bottom_abs(x_abs) + rafterSlopeHeight;

    const ridgeNotchDepth = RAFTER_H / 3;
    const ridgeSeatY = y_bottom_abs(ridgeBeamHalfWidth) + ridgeNotchDepth;
    
    const keyPoints = {
        p_ridge_top:    { x: x_ridge_plumb, y: y_top_abs(ridgeBeamHalfWidth) },
        p_tail_top:     { x: x_tail_end, y: y_top_abs(Math.abs(x_tail_end)) },
        p_tail_bottom:  { x: x_tail_end, y: y_bottom_abs(Math.abs(x_tail_end)) },
        p_heel_bottom:  { x: x_plate_outer, y: y_bottom_abs(Math.abs(x_plate_outer)) },
        p_heel_top:     { x: x_plate_outer, y: plateTopY },
        p_seat_inner:   { x: x_plate_inner, y: plateTopY },
        p_ridge_notch_outer_bottom: { x: x_ridge_seat_outer, y: y_bottom_abs(Math.abs(x_ridge_seat_outer)) },
        p_ridge_notch_outer_top:    { x: x_ridge_seat_outer, y: ridgeSeatY },
        p_ridge_notch_inner:        { x: x_ridge_plumb, y: ridgeSeatY },
        p_purlin_seat_start: null as {x: number, y: number} | null,
        p_purlin_plumb_start_bottom: null as {x: number, y: number} | null,
        p_purlin_seat_end: null as {x: number, y: number} | null,
        p_purlin_plumb_end_bottom: null as {x: number, y: number} | null,
    };
    
    let rawPoints: {x: number, y: number}[] = [
        keyPoints.p_ridge_top, keyPoints.p_tail_top, keyPoints.p_tail_bottom, keyPoints.p_heel_bottom, keyPoints.p_heel_top, keyPoints.p_seat_inner
    ];

    if (middlePurlinInfo) {
        const { centerX, width, seatY } = middlePurlinInfo;
        const purlin_inner_x = sign * (centerX - width / 2);
        const purlin_outer_x = sign * (centerX + width / 2);
        keyPoints.p_purlin_plumb_start_bottom = { x: purlin_inner_x, y: y_bottom_abs(Math.abs(purlin_inner_x)) };
        keyPoints.p_purlin_seat_start = { x: purlin_inner_x, y: seatY };
        keyPoints.p_purlin_seat_end = { x: purlin_outer_x, y: seatY };
        keyPoints.p_purlin_plumb_end_bottom = { x: purlin_outer_x, y: y_bottom_abs(Math.abs(purlin_outer_x)) };
        rawPoints.push(keyPoints.p_purlin_plumb_end_bottom, keyPoints.p_purlin_seat_end, keyPoints.p_purlin_seat_start, keyPoints.p_purlin_plumb_start_bottom);
    }
    
    rawPoints.push(keyPoints.p_ridge_notch_outer_bottom, keyPoints.p_ridge_notch_outer_top, keyPoints.p_ridge_notch_inner);
    rawPoints = rawPoints.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i-1].x, p.y - arr[i-1].y) > 1e-6);

    return createRafterDrawingInternal(rawPoints, keyPoints, RAFTER_W, RAFTER_H, roofPitch);
};

/**
 * Creates DrawingInfo for a Carport Pultdach (shed roof) rafter.
 */
export const createCarportPultdachRafterDrawing = (
    W: number, BEAM_W: number, RAFTER_W: number, RAFTER_H: number, H: number, roofOverhang: number, roofPitch: number,
    middlePurlinInfo: {centerX: number, width: number, height: number, seatY: number} | null
): { drawingInfo: DrawingInfo, totalLength: number } => {
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const tanA = Math.tan(roofAngleRad);
    const cosA = Math.cos(roofAngleRad);
    
    const slope = -tanA;
    const high_post_x = -W/2;
    const low_post_x = W/2;
    const high_purlin_ref_x = high_post_x - BEAM_W / 2;
    const high_purlin_seat_y = H;
    const C = high_purlin_seat_y - slope * high_purlin_ref_x;
    const rafterUndersideY = (x:number) => slope * x + C;
    
    const low_purlin_ref_x = low_post_x - BEAM_W / 2;
    const low_purlin_seat_y = rafterUndersideY(low_purlin_ref_x);

    const rafterSlopeHeight = RAFTER_H / cosA;
    const y_top = (x:number) => rafterUndersideY(x) + rafterSlopeHeight;
    const high_purlin_x_inner = high_post_x + BEAM_W / 2, high_purlin_x_outer = high_post_x - BEAM_W / 2;
    const low_purlin_x_inner = low_post_x - BEAM_W / 2, low_purlin_x_outer = low_post_x + BEAM_W / 2;
    const x_rafter_end_high = high_purlin_x_outer - roofOverhang, x_rafter_end_low = low_purlin_x_outer + roofOverhang;

     const keyPoints = {
        p_ridge_top: {x:x_rafter_end_high, y: y_top(x_rafter_end_high)}, // Use high end as ridge equivalent
        p_tail_top: {x:x_rafter_end_low, y: y_top(x_rafter_end_low)}, // Use low end as tail equivalent
        p_tail_bottom: {x:x_rafter_end_low, y: rafterUndersideY(x_rafter_end_low)},
        // Map pultdach points to satteldach key names for reuse
        p_heel_bottom: {x:low_purlin_x_outer, y: rafterUndersideY(low_purlin_x_outer)},
        p_heel_top: {x:low_purlin_x_outer, y: low_purlin_seat_y},
        p_seat_inner: {x:low_purlin_x_inner, y: low_purlin_seat_y},
        p_ridge_notch_outer_bottom: {x:high_purlin_x_outer, y: rafterUndersideY(high_purlin_x_outer)},
        p_ridge_notch_outer_top: {x:high_purlin_x_outer, y: high_purlin_seat_y},
        p_ridge_notch_inner: {x:high_purlin_x_inner, y: high_purlin_seat_y},
        p_purlin_seat_start: null as {x: number, y: number} | null,
        p_purlin_plumb_start_bottom: null as {x: number, y: number} | null,
        p_purlin_seat_end: null as {x: number, y: number} | null,
        p_purlin_plumb_end_bottom: null as {x: number, y: number} | null,
    };
    
    const bottomPath = [ keyPoints.p_ridge_notch_inner, keyPoints.p_ridge_notch_outer_top, keyPoints.p_ridge_notch_outer_bottom ];

    if (middlePurlinInfo) {
        const { centerX, width, seatY } = middlePurlinInfo;
        keyPoints.p_purlin_seat_start = { x: centerX - width / 2, y: seatY };
        keyPoints.p_purlin_seat_end = { x: centerX + width / 2, y: seatY };
        keyPoints.p_purlin_plumb_start_bottom = { x: keyPoints.p_purlin_seat_start.x, y: rafterUndersideY(keyPoints.p_purlin_seat_start.x) };
        keyPoints.p_purlin_plumb_end_bottom = { x: keyPoints.p_purlin_seat_end.x, y: rafterUndersideY(keyPoints.p_purlin_seat_end.x) };
        bottomPath.push(keyPoints.p_purlin_plumb_start_bottom, keyPoints.p_purlin_seat_start, keyPoints.p_purlin_seat_end, keyPoints.p_purlin_plumb_end_bottom);
    }
    
    bottomPath.push(keyPoints.p_seat_inner, keyPoints.p_heel_top, keyPoints.p_heel_bottom);

    const rawPoints = [ keyPoints.p_ridge_top, keyPoints.p_tail_top, keyPoints.p_tail_bottom, ...bottomPath.reverse() ]
        .filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i-1].x, p.y - arr[i-1].y) > 1e-6);
    
    return createRafterDrawingInternal(rawPoints, keyPoints, RAFTER_W, RAFTER_H, roofPitch);
};


// --- Gartenhaus Specific Drawing Functions ---

/**
 * Creates markers and dimensions for stud layouts on a beam.
 */
export const generateStudMarkings = (layout: { positions: number[], spacings: number[] }, beamHeight: number, xOffset: number = 0): { markers: Marker[], dimensions: Dimension[] } => {
    const markers: Marker[] = [];
    const dimensions: Dimension[] = [];
    if (!layout || !layout.positions) return { markers, dimensions };
    
    layout.positions.forEach(pos => {
        markers.push({ position: xOffset + pos, orientation: 'vertical', text: 'Ständer' });
    });

    for (let i = 0; i < layout.positions.length - 1; i++) {
        const p1_x = xOffset + layout.positions[i];
        const p2_x = xOffset + layout.positions[i+1];
        dimensions.push({
            type: 'linear_horizontal',
            p1: { x: p1_x, y: beamHeight },
            p2: { x: p2_x, y: beamHeight },
            offset: 70,
            label: `${(layout.spacings[i] * 100).toFixed(1)}cm`
        });
    }
    
    return { markers, dimensions };
};

/**
 * Creates DrawingInfo for a Gartenhaus wall brace.
 */
export const createGartenhausBraceInfo = (horizontalRun: number, verticalRun: number, braceWidthForDrawing: number, braceThicknessFor3D: number, STUD_THICKNESS: number): { drawingInfo: DrawingInfo, outerLength: number, angleRad: number, description: string } => {
    const H_formel = verticalRun;
    const B_formel = horizontalRun;
    const D_formel = STUD_THICKNESS; // Strebendicke in Formel

    if (H_formel < 0.01 || B_formel < 0.01) {
        return { drawingInfo: getDrawingInfo([], braceThicknessFor3D), outerLength: 0, angleRad: 0, description: "" };
    }

    const C = (H_formel * H_formel) + (B_formel * B_formel);
    const E = (H_formel * H_formel) - (D_formel * D_formel);
    const term_under_sqrt = (B_formel * B_formel * D_formel * D_formel) + (C * E);
    if (term_under_sqrt < 0 || C < 1e-9) {
         return { drawingInfo: getDrawingInfo([], braceThicknessFor3D), outerLength: 0, angleRad: 0, description: "Berechnung nicht möglich." };
    }

    const numerator = (B_formel * D_formel) + Math.sqrt(term_under_sqrt);
    let asin_arg = numerator / C;
    asin_arg = Math.max(-1.0, Math.min(1.0, asin_arg));

    const angleFromHorizontal_rad = Math.asin(asin_arg);
    const cutAngleFromVertical_rad = (Math.PI / 2.0) - angleFromHorizontal_rad;

    if (Math.abs(Math.cos(cutAngleFromVertical_rad)) < 1e-9) {
        return { drawingInfo: getDrawingInfo([], braceThicknessFor3D), outerLength: 0, angleRad: 0, description: "Berechnung nicht möglich (cos=0)." };
    }
    
    const cos_angle_vert = Math.cos(cutAngleFromVertical_rad);
    const tan_angle_vert = Math.tan(cutAngleFromVertical_rad);

    const p1 = { x: 0, y: 0 };
    const p2 = { x: H_formel / cos_angle_vert, y: 0 };
    const p3 = { x: (H_formel / cos_angle_vert) + (braceWidthForDrawing * tan_angle_vert), y: braceWidthForDrawing };
    const p4 = { x: braceWidthForDrawing * tan_angle_vert, y: braceWidthForDrawing };
    const drawingPoints = [p1, p2, p3, p4];

    const outerLength = Math.hypot(p3.x, p3.y); // Spitz-zu-Spitz-Länge

    const dimensions: Dimension[] = [];
    const referenceLines: ReferenceLine[] = [];
    
    dimensions.push({ type: 'linear_horizontal', p1: {x:0, y:braceWidthForDrawing}, p2: p3, offset: 45, label: `Länge: ${(outerLength * 100).toFixed(1)}cm` });
    dimensions.push({ type: 'linear_vertical', p1: p1, p2: p4, offset: -40, label: `${(braceWidthForDrawing*100).toFixed(1)}cm`});

    const sawAngleDeg = 90 - (angleFromHorizontal_rad * 180 / Math.PI);
    const angleLabel = `${sawAngleDeg.toFixed(1)}°`;
    const radius = 40;
    const lineLen = 0.35;

    const getEndPoint = (origin: {x:number, y:number}, v: {x:number, y:number}) => {
        const mag = Math.hypot(v.x, v.y);
        if (mag < 1e-6) return origin;
        return { x: origin.x + (v.x / mag) * lineLen, y: origin.y + (v.y / mag) * lineLen };
    };

    // Left cut angle (top-left corner of the parallelogram)
    const angle_corner_left = p4;
    // Helper line pointing straight up from the corner
    const p_ref_perp_left = {x: angle_corner_left.x, y: angle_corner_left.y - lineLen};
    // Helper line extending the cut upwards and to the left
    const v_cut_left = { x: p1.x - angle_corner_left.x, y: p1.y - angle_corner_left.y };
    const p_ref_cut_left = getEndPoint(angle_corner_left, v_cut_left);
    referenceLines.push({ p1: angle_corner_left, p2: p_ref_perp_left, style: 'dashed' });
    referenceLines.push({ p1: angle_corner_left, p2: p_ref_cut_left, style: 'dashed' });
    dimensions.push({ type: 'angular', center: angle_corner_left, p1: p_ref_perp_left, p2: p_ref_cut_left, radius, label: angleLabel });


    // Right cut angle (top-right corner)
    const angle_corner_right = p3;
     // Helper line pointing straight up from the corner
    const p_ref_perp_right = {x: angle_corner_right.x, y: angle_corner_right.y - lineLen};
    // Helper line extending the cut upwards and to the right
    const v_cut_right = { x: p2.x - angle_corner_right.x, y: p2.y - angle_corner_right.y };
    const p_ref_cut_right = getEndPoint(angle_corner_right, v_cut_right);
    referenceLines.push({ p1: angle_corner_right, p2: p_ref_perp_right, style: 'dashed' });
    referenceLines.push({ p1: angle_corner_right, p2: p_ref_cut_right, style: 'dashed' });
    dimensions.push({ type: 'angular', center: angle_corner_right, p1: p_ref_perp_right, p2: p_ref_cut_right, radius, label: angleLabel });


    const description = `
Berechnungsdetails für Strebe:
- Feldhöhe (H): ${(H_formel * 1000).toFixed(1)} mm
- Feldbreite (B): ${(B_formel * 1000).toFixed(1)} mm
- Strebendicke (D): ${(D_formel * 1000).toFixed(1)} mm
- Strebenwinkel (α): ${(angleFromHorizontal_rad * 180 / Math.PI).toFixed(2)} °
- Schnittwinkel zur Vertikalen: ${(cutAngleFromVertical_rad * 180 / Math.PI).toFixed(2)} °`;

    return {
        drawingInfo: getDrawingInfo(drawingPoints, braceThicknessFor3D, dimensions, [], referenceLines),
        outerLength: outerLength,
        angleRad: angleFromHorizontal_rad,
        description: description
    };
};

/**
 * Creates DrawingInfo for a Gartenhaus Satteldach (gable roof) rafter.
 */
export const createGartenhausSatteldachRafterDrawing = (
    W: number, TOP_PLATE_W: number, H: number, roofOverhang: number, roofPitch: number, BEAM_W: number, RAFTER_H: number, RAFTER_W: number
): { drawingInfo: DrawingInfo, totalLength: number } => {
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const tanA = Math.tan(roofAngleRad);
    const cosA = Math.cos(roofAngleRad);
    const plateTopY = H;

    const sign = 1;
    const rafterSlopeHeight = RAFTER_H / cosA;
    const ridgeBeamHalfWidth = BEAM_W / 2;
    const plateWidth = TOP_PLATE_W;
    const x_ridge_plumb = 0, x_ridge_seat_outer = sign * ridgeBeamHalfWidth;
    const x_plate_outer = sign * (W/2), x_plate_inner = sign * (W/2 - plateWidth);
    const x_tail_end = sign * (W/2 + roofOverhang);
    
    const y_bottom_abs = (x_abs:number) => -tanA * (Math.abs(x_abs) - (W/2 - plateWidth)) + plateTopY;
    const y_top_abs = (x_abs:number) => y_bottom_abs(x_abs) + rafterSlopeHeight;
    
    const ridgeNotchDepth = RAFTER_H / 3;
    const ridgeSeatY = y_bottom_abs(ridgeBeamHalfWidth) + ridgeNotchDepth;

    const keyPoints = {
        p_ridge_top:    { x: x_ridge_plumb, y: y_top_abs(ridgeBeamHalfWidth) },
        p_tail_top:     { x: x_tail_end, y: y_top_abs(Math.abs(x_tail_end)) },
        p_tail_bottom:  { x: x_tail_end, y: y_bottom_abs(Math.abs(x_tail_end)) },
        p_heel_bottom:  { x: x_plate_outer, y: y_bottom_abs(Math.abs(x_plate_outer)) },
        p_heel_top:     { x: x_plate_outer, y: plateTopY },
        p_seat_inner:   { x: x_plate_inner, y: plateTopY },
        p_ridge_notch_outer_bottom: { x: x_ridge_seat_outer, y: y_bottom_abs(Math.abs(x_ridge_seat_outer)) },
        p_ridge_notch_outer_top:    { x: x_ridge_seat_outer, y: ridgeSeatY },
        p_ridge_notch_inner:        { x: x_ridge_plumb, y: ridgeSeatY },
        p_purlin_seat_start: null, // No middle purlin for gartenhaus
        p_purlin_plumb_start_bottom: null,
        p_purlin_seat_end: null,
        p_purlin_plumb_end_bottom: null
    };
    
    let rawPoints: {x: number, y: number}[] = [
        keyPoints.p_ridge_top, keyPoints.p_tail_top, keyPoints.p_tail_bottom, keyPoints.p_heel_bottom, keyPoints.p_heel_top, keyPoints.p_seat_inner,
        keyPoints.p_ridge_notch_outer_bottom, keyPoints.p_ridge_notch_outer_top, keyPoints.p_ridge_notch_inner
    ];
    
    rawPoints = rawPoints.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i-1].x, p.y - arr[i-1].y) > 1e-6);

    return createRafterDrawingInternal(rawPoints, keyPoints, RAFTER_W, RAFTER_H, roofPitch);
};
