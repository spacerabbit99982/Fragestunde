
import * as THREE from 'three';
import { RoofType, PartInfo, DrawingInfo, Dimension, Marker, ReferenceLine } from './types';
import { getDrawingInfo, createBoxDrawingInfo, createMiteredBraceDrawingInfo, createCarportSatteldachRafterDrawing, createCarportPultdachRafterDrawing } from './drawingUtils';

/**
 * Erstellt den JavaScript-Code für das 3D-Modell sowie eine exakte Stückliste mit 2D-Zeichnungsinformationen.
 */
export const generateConstructionPlan = (params: {
  W: number, D: number, H: number, roofType: RoofType, roofOverhang: number, roofPitch: number,
  POST_DIM: number, BEAM_W: number, BEAM_H: number, RAFTER_W: number, RAFTER_H: number, BRACE_DIM: number,
  COUNTER_BATTEN_W: number, COUNTER_BATTEN_H: number,
  numberOfPostsPerSide: number,
  middlePurlin: { w: number, h: number } | null
}) => {
    const { W, D, H, roofType, roofPitch, POST_DIM, BEAM_W, BEAM_H, RAFTER_W, RAFTER_H, BRACE_DIM, COUNTER_BATTEN_W, COUNTER_BATTEN_H, numberOfPostsPerSide, middlePurlin, roofOverhang } = params;

    const parts = new Map<string, PartInfo>();
    let braces_3d: any[] = [];

    const addPart = (key: string, description: string, drawingInfo?: DrawingInfo, quantity = 1) => {
        if (!parts.has(key)) {
            parts.set(key, { key, quantity: 0, description, drawingInfo });
        }
        parts.get(key)!.quantity += quantity;
    };
    
    // Calculate parts list with drawing info
    const numRaftersTotal = Math.max(2, Math.floor(D / 0.8) + 1);
    const rafterSpacing = (numRaftersTotal > 1) ? (D - RAFTER_W) / (numRaftersTotal - 1) : 0;
    
    const firstRafterCenterPos = RAFTER_W / 2;
    const purlinMarkers: Marker[] = [];
    const purlinDimensions: Dimension[] = [];

    for (let i = 0; i < numRaftersTotal; i++) {
        purlinMarkers.push({
            position: firstRafterCenterPos + i * rafterSpacing,
            orientation: 'vertical',
            text: `Mitte Sparren`
        });
    }
    if (numRaftersTotal > 0) {
        purlinDimensions.push({
            type: 'linear_horizontal', p1: { x: 0, y: 0 }, p2: { x: firstRafterCenterPos, y: 0 },
            offset: 50, label: `${(firstRafterCenterPos * 100).toFixed(1)}cm`
        });
    }
    if (numRaftersTotal > 1) {
        purlinDimensions.push({
            type: 'linear_horizontal', p1: { x: firstRafterCenterPos, y: 0 }, p2: { x: firstRafterCenterPos + rafterSpacing, y: 0 },
            offset: 70, label: `Abstand: ${(rafterSpacing * 100).toFixed(1)}cm`
        });
    }

    const getCuttingList = (rowLength: number, stockLength: number, jointPositions: number[]): number[] => {
        const cuts: number[] = [];
        let coveredLength = 0;
        const epsilon = 1e-6;

        while (coveredLength < rowLength - epsilon) {
            const remaining = rowLength - coveredLength;
            const startZ = -rowLength / 2 + coveredLength;
            const idealCutLength = Math.min(remaining, stockLength);
            const idealEndZ = startZ + idealCutLength;
            
            const possibleJoints = jointPositions.filter(z => z > startZ + epsilon && z < idealEndZ + epsilon);

            let currentCutLength: number;
            if (remaining <= stockLength + epsilon || possibleJoints.length === 0) {
                currentCutLength = remaining;
            } else {
                const jointZ = Math.max(...possibleJoints);
                currentCutLength = jointZ - startZ;
            }

            if (currentCutLength > epsilon) {
                 cuts.push(currentCutLength);
                 coveredLength += currentCutLength;
            } else {
                // Failsafe to prevent infinite loops
                break;
            }
        }
        return cuts;
    };
    
    if (roofType === 'Satteldach') {
        const plateTopY = H;
        const postHeight = plateTopY - BEAM_H;
        const numPosts = Math.max(2, numberOfPostsPerSide || 2);
        
        const postBraceSchenkel = Math.min(0.7, Math.max(0.1, postHeight - 0.1));
        
        // Main posts drawing (horizontal layout)
        const postPoints = [ { x: 0, y: 0 }, { x: postHeight, y: 0 }, { x: postHeight, y: POST_DIM }, { x: 0, y: POST_DIM }];
        const postMarkers: Marker[] = [{ position: postHeight - postBraceSchenkel, orientation: 'vertical', text: 'Anriss Kopfb.' }];
        const postDimensions: Dimension[] = [
             { type: 'linear_horizontal', p1: {x:0, y:POST_DIM}, p2: {x:postHeight, y:POST_DIM}, offset: 80, label: `${(postHeight * 100).toFixed(1)}cm` },
             { type: 'linear_horizontal', p1: {x: postHeight - postBraceSchenkel, y: POST_DIM}, p2: {x: postHeight, y: POST_DIM}, offset: 50, label: `${(postBraceSchenkel*100).toFixed(1)}cm`},
             { type: 'linear_vertical', p1: {x:0, y:0}, p2: {x:0, y:POST_DIM}, offset: -40, label: `${(POST_DIM * 100).toFixed(1)}cm` }
        ];
        const postDrawing = getDrawingInfo(postPoints, POST_DIM, postDimensions, postMarkers);
        addPart('post', `Pfosten ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(postHeight*100).toFixed(1)}cm`, postDrawing, numPosts * 2);

        // Purlins / Plates (Längspfetten)
        const sidePlateDesc = `Längspfetten ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
        const sidePlateDrawing = createBoxDrawingInfo(D, Math.max(BEAM_H, BEAM_W), Math.min(BEAM_H, BEAM_W), purlinDimensions, purlinMarkers);
        parts.set('side_plate', { key: 'side_plate', quantity: 2, description: sidePlateDesc, drawingInfo: sidePlateDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });
        
        // Tie beams
        const tieBeamLength = W - POST_DIM;
        addPart('tie_beam', `Zangen/Querhölzer ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(tieBeamLength*100).toFixed(1)}cm`, createBoxDrawingInfo(tieBeamLength, Math.max(BEAM_H, BEAM_W), Math.min(BEAM_H, BEAM_W)), numPosts);

        // Ridge beam and king posts
        const roofAngleRad = (roofPitch * Math.PI) / 180;
        const tanA = Math.tan(roofAngleRad);
        const ridgeBeamHalfWidth = BEAM_W / 2;
        const plateInnerX = W / 2 - BEAM_W / 2;
        const y_bottom_abs_saddle = (x:number) => -tanA * (Math.abs(x) - plateInnerX) + plateTopY;
        
        const ridgeNotchDepth = RAFTER_H / 3; // Cut upwards from bottom line
        const ridgeSeatY = y_bottom_abs_saddle(ridgeBeamHalfWidth) + ridgeNotchDepth;

        const ridgeBeamCenterY = ridgeSeatY - BEAM_H / 2;
        const kingPostTopY = ridgeBeamCenterY - BEAM_H / 2;
        const kingPostHeight = kingPostTopY - plateTopY;
        const postDistributionLength = D - (2 * roofOverhang);
        const postZPositions = Array.from({length: numPosts}, (_, i) => -postDistributionLength / 2 + i * (postDistributionLength / (numPosts - 1 || 1)));

        if (kingPostHeight > 0.1) {
            const kingBraceSchenkel = Math.min(0.7, Math.max(0.1, kingPostHeight - 0.05));
            const kingPostPoints = [ { x: 0, y: 0 }, { x: kingPostHeight, y: 0 }, { x: kingPostHeight, y: POST_DIM }, { x: 0, y: POST_DIM }];
            const kingPostMarkers: Marker[] = [{ position: kingPostHeight - kingBraceSchenkel, orientation: 'vertical', text: 'Anriss Kopfb.' }];
            const kingPostDimensions: Dimension[] = [
                 { type: 'linear_horizontal', p1: {x:0, y:POST_DIM}, p2: {x:kingPostHeight, y:POST_DIM}, offset: 80, label: `${(kingPostHeight * 100).toFixed(1)}cm` },
                 { type: 'linear_horizontal', p1: {x:kingPostHeight - kingBraceSchenkel, y:POST_DIM}, p2: {x:kingPostHeight, y:POST_DIM}, offset: 50, label: `${(kingBraceSchenkel*100).toFixed(1)}cm`},
                 { type: 'linear_vertical', p1: {x:0, y:0}, p2: {x:0, y:POST_DIM}, offset: -40, label: `${(POST_DIM * 100).toFixed(1)}cm` }
            ];
            const kingPostDrawing = getDrawingInfo(kingPostPoints, POST_DIM, kingPostDimensions, kingPostMarkers);
            addPart('king_post', `First-Stütze ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(kingPostHeight*100).toFixed(1)}cm`, kingPostDrawing, numPosts);
            
            const { drawingInfo, outerLength } = createMiteredBraceDrawingInfo(kingBraceSchenkel, BRACE_DIM);
            if (postZPositions.length > 1) { // Only add braces if there are end posts for them
                addPart(`brace_king_${Math.round(outerLength*100)}`, `Kopfband First-Stütze ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(outerLength*100).toFixed(1)}cm`, drawingInfo, 2);
            
                const ridgeBraceCenterY = kingPostTopY - kingBraceSchenkel / 2;
                const frontKingPostZ = postZPositions[postZPositions.length - 1];
                const backKingPostZ = postZPositions[0];
                braces_3d.push({ schenkel: kingBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: false, pos: [0, ridgeBraceCenterY, frontKingPostZ - POST_DIM/2 - kingBraceSchenkel / 2], rot: [-Math.PI / 4, 0, 0] });
                braces_3d.push({ schenkel: kingBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: true,  pos: [0, ridgeBraceCenterY, backKingPostZ + POST_DIM/2 + kingBraceSchenkel / 2],  rot: [Math.PI / 4, 0, 0] });
            }
        }
        if (BEAM_W > 0) {
            const ridgePurlinDesc = `Firstpfette ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
            const ridgePurlinDrawing = createBoxDrawingInfo(D, Math.max(BEAM_H, BEAM_W), Math.min(BEAM_W, BEAM_W), purlinDimensions, purlinMarkers);
            parts.set('ridge_beam', { key: 'ridge_beam', quantity: 1, description: ridgePurlinDesc, drawingInfo: ridgePurlinDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });
        }

        // Middle purlins and support posts
        let middlePurlinInfoForDrawing: any = null;
        if (middlePurlin && middlePurlin.w > 0 && middlePurlin.h > 0) {
            const middlePurlin_horizontal_span = (W / 2 - BEAM_W / 2) - ridgeBeamHalfWidth;
            const middlePurlin_center_x = ridgeBeamHalfWidth + middlePurlin_horizontal_span / 2;

            const purlinUphillCornerX = middlePurlin_center_x - middlePurlin.w / 2;
            const seatY = y_bottom_abs_saddle(purlinUphillCornerX);

            middlePurlinInfoForDrawing = { 
                centerX: middlePurlin_center_x, 
                width: middlePurlin.w, 
                height: middlePurlin.h,
                seatY: seatY 
            };
        
            const middlePurlinDesc = `Mittelpfette ${(middlePurlin.w*100).toFixed(1)}x${(middlePurlin.h*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
            const middlePurlinDrawing = createBoxDrawingInfo(D, Math.max(middlePurlin.h, middlePurlin.w), Math.min(middlePurlin.h, middlePurlin.w), purlinDimensions, purlinMarkers);
            parts.set('middle_purlin', { key: 'middle_purlin', quantity: 2, description: middlePurlinDesc, drawingInfo: middlePurlinDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });
        
            const supportPostBottomY = plateTopY;
            const supportPostTopY = seatY - middlePurlin.h;
            const supportPostHeight = supportPostTopY - supportPostBottomY;

            if (supportPostHeight > 0.01) {
                addPart('support_post', `Mittelpfetten-Stütze ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(supportPostHeight*100).toFixed(1)}cm`, createBoxDrawingInfo(supportPostHeight, POST_DIM, POST_DIM), numPosts * 2);
            }
        }

        // Main braces
        const mainBraceSchenkel = Math.min(0.7, Math.max(0.1, postHeight - BEAM_H - 0.1), Math.max(0.1, (tieBeamLength / 2) - POST_DIM/2 - 0.1));
        const { drawingInfo: mainBraceDrawing, outerLength: mainBraceOuterLength } = createMiteredBraceDrawingInfo(mainBraceSchenkel, BRACE_DIM);
        
        const transversalBraceZPositions = [];
        if (postZPositions.length > 0) {
            transversalBraceZPositions.push(postZPositions[0]);
            if (postZPositions.length > 1) {
                transversalBraceZPositions.push(postZPositions[postZPositions.length - 1]);
            }
        }

        const tieBeamBraceCenterY = plateTopY - BEAM_H - mainBraceSchenkel / 2;
        const postInnerEdgeX = W / 2 - POST_DIM / 2;
        transversalBraceZPositions.forEach(zPos => {
             addPart(`brace_main_trans_${Math.round(mainBraceOuterLength*100)}`, `Kopfband Pfosten (quer) ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(mainBraceOuterLength*100).toFixed(1)}cm`, mainBraceDrawing, 2);
             braces_3d.push({ schenkel: mainBraceSchenkel, dim: BRACE_DIM, axis: 'x', mirrored: false, pos: [postInnerEdgeX - mainBraceSchenkel / 2, tieBeamBraceCenterY, zPos], rot: [0, 0, Math.PI / 4] });
             braces_3d.push({ schenkel: mainBraceSchenkel, dim: BRACE_DIM, axis: 'x', mirrored: true,  pos: [-postInnerEdgeX + mainBraceSchenkel / 2, tieBeamBraceCenterY, zPos], rot: [0, 0, -Math.PI / 4] });
        });
        
        const braceCenterY = postHeight - mainBraceSchenkel / 2;
        if (postZPositions.length > 1) {
          const frontPostZ = postZPositions[postZPositions.length - 1];
          const backPostZ = postZPositions[0];
          const postInnerEdgeZ_front = frontPostZ - POST_DIM / 2;
          const postInnerEdgeZ_back = backPostZ + POST_DIM / 2;
          addPart(`brace_main_long_${Math.round(mainBraceOuterLength*100)}`, `Kopfband Pfosten (längs) ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(mainBraceOuterLength*100).toFixed(1)}cm`, mainBraceDrawing, 4);
          [-W/2, W/2].forEach(x => {
               braces_3d.push({ schenkel: mainBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: false, pos: [x, braceCenterY, postInnerEdgeZ_front - mainBraceSchenkel / 2], rot: [-Math.PI / 4, 0, 0] });
               braces_3d.push({ schenkel: mainBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: true,  pos: [x, braceCenterY, postInnerEdgeZ_back + mainBraceSchenkel / 2],  rot: [Math.PI / 4, 0, 0] });
          });
        }

        const { drawingInfo: rafterDrawing, totalLength: rafterLength } = createCarportSatteldachRafterDrawing(W, BEAM_W, RAFTER_W, RAFTER_H, H, roofOverhang, roofPitch, middlePurlinInfoForDrawing);
        addPart('rafter', `Sparren ${(RAFTER_W*100).toFixed(1)}x${(RAFTER_H*100).toFixed(1)}cm, Länge: ${(rafterLength*100).toFixed(1)}cm`, rafterDrawing, numRaftersTotal * 2);

        // Counter battens
        if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0 && rafterLength > 0.1) {
            const BATTEN_SPACING = 0.35; // 35cm spacing
            const rafterZPositions = Array.from({ length: numRaftersTotal }, (_, i) => -D / 2 + (RAFTER_W / 2) + i * rafterSpacing);

            const numRowsPerSlope = Math.ceil(rafterLength / BATTEN_SPACING);
            const allCuts: number[] = [];
            for (let i = 0; i < numRowsPerSlope * 2; i++) { // *2 for both slopes
                allCuts.push(...getCuttingList(D, 5.0, rafterZPositions));
            }
            
            if (allCuts.length > 0) {
                 const stockLength = 5.0;
                const kerf = 0.005; // 5mm saw kerf

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

                const numStock = bins.length;
                
                const cuttingPlanSummary: Record<string, number> = {};
                for (const bin of bins) {
                    const key = bin.sort((a, b) => b - a).map(c => `${(c * 100).toFixed(1)}cm`).join(' + ');
                    cuttingPlanSummary[key] = (cuttingPlanSummary[key] || 0) + 1;
                }

                let desc = `Traglatten ${Math.round(COUNTER_BATTEN_W*1000)}x${Math.round(COUNTER_BATTEN_H*1000)}mm (${numStock} x 5m Stangen)`;
                const cuttingPlanLines = Object.entries(cuttingPlanSummary)
                  .map(([plan, count]) => `${count}x 5m Stange: schneiden zu ${plan}`);
                  
                if (cuttingPlanLines.length > 0) {
                    desc += `\n\nZuschnittplan (optimiert für 5m Stangen, inkl. ${kerf*1000}mm Sägeschnitt):\n${cuttingPlanLines.join('\n')}`;
                }

                const cbDrawing = createBoxDrawingInfo(5, COUNTER_BATTEN_H, COUNTER_BATTEN_W);
                addPart('counter_batten', desc, cbDrawing, numStock);
            }
        }
    } else { // Pultdach / Flachdach
        const roofAngleRad = (roofPitch * Math.PI) / 180;
        const tanA = Math.tan(roofAngleRad);
        const slope = -tanA;
        const high_post_x = -W/2, low_post_x = W/2;
        const high_purlin_ref_x = high_post_x - BEAM_W / 2;
        const low_purlin_ref_x = low_post_x - BEAM_W / 2;
        const high_purlin_seat_y = H;
        const C = high_purlin_seat_y - slope * high_purlin_ref_x;
        const rafterUndersideY = (x:number) => slope * x + C;
        const low_purlin_seat_y = rafterUndersideY(low_purlin_ref_x);
        const highPostHeight = high_purlin_seat_y - BEAM_H;
        const lowPostHeight = low_purlin_seat_y - BEAM_H;
        const numPosts = Math.max(2, numberOfPostsPerSide || 2);
        
        const zange_y = low_purlin_seat_y - BEAM_H / 2;

        let middlePurlinInfoForPultDrawing: any = null;
        if (middlePurlin && middlePurlin.w > 0 && middlePurlin.h > 0) {
            const middlePurlin_center_x = 0; // It's in the middle
            
            const purlinUphillCornerX = middlePurlin_center_x - middlePurlin.w / 2; // Uphill is smaller x
            const seatY = rafterUndersideY(purlinUphillCornerX);

            const zange_top_y = zange_y + BEAM_H/2; // Top edge of the cross member
            const middlePurlinTopY = seatY;
            const supportPostTopY = middlePurlinTopY - middlePurlin.h;
            const supportPostHeight = supportPostTopY - zange_top_y;

            middlePurlinInfoForPultDrawing = { 
                centerX: middlePurlin_center_x, 
                width: middlePurlin.w, 
                height: middlePurlin.h,
                seatY: seatY
            };

            const middlePurlinDesc = `Mittelpfette ${(middlePurlin.w*100).toFixed(1)}x${(middlePurlin.h*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
            const middlePurlinDrawing = createBoxDrawingInfo(D, Math.max(middlePurlin.h, middlePurlin.w), Math.min(middlePurlin.h, middlePurlin.w), purlinDimensions, purlinMarkers);
            parts.set('middle_purlin_pult', { key: 'middle_purlin_pult', quantity: 1, description: middlePurlinDesc, drawingInfo: middlePurlinDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });

            if (supportPostHeight > 0.01) {
                addPart('support_post_pult', `Mittelpfetten-Stütze ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(supportPostHeight*100).toFixed(1)}cm`, createBoxDrawingInfo(supportPostHeight, POST_DIM, POST_DIM), numPosts);
            }
        }
        
        const braceSchenkel = Math.min(0.7, Math.max(0.1, lowPostHeight - BEAM_H - 0.1));
        const { drawingInfo: braceDrawing, outerLength: braceOuterLength } = createMiteredBraceDrawingInfo(braceSchenkel, BRACE_DIM);

        const highBraceSchenkel = Math.min(0.7, Math.max(0.1, highPostHeight - BEAM_H - 0.1));
        const { drawingInfo: highBraceDrawing, outerLength: highBraceOuterLength } = createMiteredBraceDrawingInfo(highBraceSchenkel, BRACE_DIM);

        // Posts (Horizontal Layout)
        const highPostPoints = [{x:0, y:0}, {x:highPostHeight, y:0}, {x:highPostHeight, y:POST_DIM}, {x:0, y:POST_DIM}];
        const highPostMarkers: Marker[] = [{ position: highPostHeight - highBraceSchenkel, orientation: 'vertical', text: 'Anriss Kopfb.' }];
        const highPostDims: Dimension[] = [
            { type: 'linear_horizontal', p1: {x:0, y:POST_DIM}, p2:{x:highPostHeight, y:POST_DIM}, offset: 80, label: `${(highPostHeight*100).toFixed(1)}cm`},
            { type: 'linear_horizontal', p1: {x:highPostHeight-highBraceSchenkel, y: POST_DIM}, p2: {x: highPostHeight, y: POST_DIM}, offset: 50, label: `${(highBraceSchenkel*100).toFixed(1)}cm`},
            { type: 'linear_vertical', p1: {x:0, y:0}, p2: {x:0, y:POST_DIM}, offset: -40, label: `${(POST_DIM * 100).toFixed(1)}cm`}
        ];
        addPart('post_high', `Pfosten Hoch ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(highPostHeight*100).toFixed(1)}cm`, getDrawingInfo(highPostPoints, POST_DIM, highPostDims, highPostMarkers), numPosts);

        const lowPostPoints = [{x:0, y:0}, {x:lowPostHeight, y:0}, {x:lowPostHeight, y:POST_DIM}, {x:0, y:POST_DIM}];
        const lowPostMarkers: Marker[] = [{ position: lowPostHeight - braceSchenkel, orientation: 'vertical', text: 'Anriss Kopfb.' }];
        const lowPostDims: Dimension[] = [
            { type: 'linear_horizontal', p1: {x:0, y:POST_DIM}, p2:{x:lowPostHeight, y:POST_DIM}, offset: 80, label: `${(lowPostHeight*100).toFixed(1)}cm`},
            { type: 'linear_horizontal', p1: {x:lowPostHeight-braceSchenkel, y:POST_DIM}, p2:{x:lowPostHeight, y:POST_DIM}, offset:50, label:`${(braceSchenkel*100).toFixed(1)}cm` },
            { type: 'linear_vertical', p1: {x:0, y:0}, p2: {x:0, y:POST_DIM}, offset: -40, label: `${(POST_DIM * 100).toFixed(1)}cm`}
        ];
        addPart('post_low', `Pfosten Tief ${(POST_DIM*100).toFixed(1)}x${(POST_DIM*100).toFixed(1)}cm, Länge: ${(lowPostHeight*100).toFixed(1)}cm`, getDrawingInfo(lowPostPoints, POST_DIM, lowPostDims, lowPostMarkers), numPosts);
        
        // Braces for parts list
        if (numPosts > 1) { // Only add longitudinal braces if there are end posts
            addPart(`brace_high_long_${Math.round(highBraceOuterLength*100)}`, `Kopfband (hoch, längs) ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(highBraceOuterLength*100).toFixed(1)}cm`, highBraceDrawing, 2);
            addPart(`brace_low_long_${Math.round(braceOuterLength*100)}`, `Kopfband (tief, längs) ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(braceOuterLength*100).toFixed(1)}cm`, braceDrawing, 2);
        }
        // Transversal (numPosts on low side)
        addPart(`brace_low_trans_${Math.round(braceOuterLength*100)}`, `Kopfband (tief, quer) ${(BRACE_DIM*100).toFixed(1)}x${(BRACE_DIM*100).toFixed(1)}cm, L: ${(braceOuterLength*100).toFixed(1)}cm`, braceDrawing, numPosts);

        const highPurlinDesc = `Pfetten Hoch ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
        const highPurlinDrawing = createBoxDrawingInfo(D, Math.max(BEAM_W, BEAM_H), Math.min(BEAM_W, BEAM_H), purlinDimensions, purlinMarkers);
        parts.set('purlin_high', { key: 'purlin_high', quantity: 1, description: highPurlinDesc, drawingInfo: highPurlinDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });

        const lowPurlinDesc = `Pfetten Tief ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
        const lowPurlinDrawing = createBoxDrawingInfo(D, Math.max(BEAM_W, BEAM_H), Math.min(BEAM_W, BEAM_H), purlinDimensions, purlinMarkers);
        parts.set('purlin_low', { key: 'purlin_low', quantity: 1, description: lowPurlinDesc, drawingInfo: lowPurlinDrawing, statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });

        const crossMemberLength = W - POST_DIM;
        addPart('cross_member', `Zangen ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(crossMemberLength*100).toFixed(1)}cm`, createBoxDrawingInfo(crossMemberLength, Math.max(BEAM_W, BEAM_H), Math.min(BEAM_W, BEAM_H)), numPosts);
        
        // 3D Braces for Pultdach
        const postDistributionLength = D - (2 * roofOverhang);
        const zPositions = Array.from({length: numPosts}, (_, i) => -postDistributionLength / 2 + i * (postDistributionLength / (numPosts - 1 || 1)));

        // Transversal braces (low side only)
        const low_post_inner_x = low_post_x - POST_DIM / 2;
        const zange_brace_y_low = zange_y - BEAM_H / 2 - braceSchenkel / 2;
        zPositions.forEach(z => {
            braces_3d.push({ schenkel: braceSchenkel, dim: BRACE_DIM, axis: 'x', mirrored: false, pos: [low_post_inner_x - braceSchenkel / 2,  zange_brace_y_low, z], rot: [0, 0, Math.PI / 4] });
        });
        
        // Longitudinal braces
        const brace_center_y_high = high_purlin_seat_y - BEAM_H - highBraceSchenkel / 2;
        const brace_center_y_low = low_purlin_seat_y - BEAM_H - braceSchenkel / 2;
        if (zPositions.length > 1) {
            const front_post_z = zPositions[zPositions.length - 1];
            const back_post_z = zPositions[0];
            braces_3d.push({ schenkel: highBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: false, pos: [high_post_x, brace_center_y_high, front_post_z - POST_DIM/2 - highBraceSchenkel / 2], rot: [-Math.PI / 4, 0, 0] });
            braces_3d.push({ schenkel: highBraceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: true,  pos: [high_post_x, brace_center_y_high, back_post_z + POST_DIM/2 + highBraceSchenkel / 2],  rot: [Math.PI / 4, 0, 0] });
            braces_3d.push({ schenkel: braceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: false, pos: [low_post_x, brace_center_y_low, front_post_z - POST_DIM/2 - braceSchenkel / 2], rot: [-Math.PI / 4, 0, 0] });
            braces_3d.push({ schenkel: braceSchenkel, dim: BRACE_DIM, axis: 'z', mirrored: true,  pos: [low_post_x, brace_center_y_low, back_post_z + POST_DIM/2 + braceSchenkel / 2],   rot: [Math.PI / 4, 0, 0] });
        }
        
        const { drawingInfo: rafterDrawing, totalLength: rafterTotalLength } = createCarportPultdachRafterDrawing(W, BEAM_W, RAFTER_W, RAFTER_H, H, roofOverhang, roofPitch, middlePurlinInfoForPultDrawing);
        addPart('rafter_sloped', `Sparren ${(RAFTER_W*100).toFixed(1)}x${(RAFTER_H*100).toFixed(1)}cm, Länge: ${(rafterTotalLength*100).toFixed(1)}cm`, rafterDrawing, numRaftersTotal);
        
        // Counter battens
        if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0 && rafterTotalLength > 0.1) {
            const BATTEN_SPACING = 0.35;
            const rafterZPositions = Array.from({ length: numRaftersTotal }, (_, i) => -D / 2 + (RAFTER_W / 2) + i * rafterSpacing);
            const numRows = Math.ceil(rafterTotalLength / BATTEN_SPACING);
            const allCuts: number[] = [];
            for (let i = 0; i < numRows; i++) {
                allCuts.push(...getCuttingList(D, 5.0, rafterZPositions));
            }

            if (allCuts.length > 0) {
                const stockLength = 5.0;
                const kerf = 0.005; // 5mm saw kerf

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

                const numStock = bins.length;
                
                const cuttingPlanSummary: Record<string, number> = {};
                for (const bin of bins) {
                    const key = bin.sort((a, b) => b - a).map(c => `${(c * 100).toFixed(1)}cm`).join(' + ');
                    cuttingPlanSummary[key] = (cuttingPlanSummary[key] || 0) + 1;
                }

                let desc = `Traglatten ${Math.round(COUNTER_BATTEN_W * 1000)}x${Math.round(COUNTER_BATTEN_H * 1000)}mm (${numStock} x 5m Stangen)`;
                const cuttingPlanLines = Object.entries(cuttingPlanSummary)
                  .map(([plan, count]) => `${count}x 5m Stange: schneiden zu ${plan}`);
                  
                if (cuttingPlanLines.length > 0) {
                     desc += `\n\nZuschnittplan (optimiert für 5m Stangen, inkl. ${kerf*1000}mm Sägeschnitt):\n${cuttingPlanLines.join('\n')}`;
                }

                const cbDrawing = createBoxDrawingInfo(5, COUNTER_BATTEN_H, COUNTER_BATTEN_W);
                addPart('counter_batten', desc, cbDrawing, numStock);
            }
        }
    }

    const mainModelCode = `
    const { W, D, H, roofType, roofOverhang, roofPitch, POST_DIM, BEAM_W, BEAM_H, RAFTER_W, RAFTER_H, BRACE_DIM, COUNTER_BATTEN_W, COUNTER_BATTEN_H, numberOfPostsPerSide, middlePurlin, braces_3d } = {
      W: ${W}, D: ${D}, H: ${H}, roofType: '${roofType}', roofOverhang: ${roofOverhang}, roofPitch: ${roofPitch},
      POST_DIM: ${POST_DIM}, BEAM_W: ${BEAM_W}, BEAM_H: ${BEAM_H}, RAFTER_W: ${RAFTER_W}, RAFTER_H: ${RAFTER_H}, BRACE_DIM: ${BRACE_DIM},
      COUNTER_BATTEN_W: ${COUNTER_BATTEN_W}, COUNTER_BATTEN_H: ${COUNTER_BATTEN_H},
      numberOfPostsPerSide: ${numberOfPostsPerSide},
      middlePurlin: ${JSON.stringify(middlePurlin)},
      braces_3d: ${JSON.stringify(braces_3d)}
    };

    const group = new THREE.Group();
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const tanA = Math.tan(roofAngleRad);
    const cosA = Math.cos(roofAngleRad);
    const post_center_x = W / 2;
    const post_center_z = D / 2;
    const plateWidth = BEAM_W; 
    
    const verticalElementMats = [woodMaterialVertical, woodMaterialVertical, endGrainMaterial, endGrainMaterial, woodMaterialVertical, woodMaterialVertical];
    const xAlignedElementMats = [endGrainMaterial, endGrainMaterial, woodMaterial, woodMaterial, woodMaterial, woodMaterial];
    const zAlignedElementMats = [woodMaterial, woodMaterial, woodMaterial, woodMaterial, endGrainMaterial, endGrainMaterial];
    const yAlignedElementMats = [woodMaterial, woodMaterial, endGrainMaterial, endGrainMaterial, woodMaterial, woodMaterial];


    const createMiteredBraceGeom = (schenkelLength, braceDim, shearAxis, mirrored = false) => {
        const braceLength = Math.sqrt(2) * schenkelLength;
        const geom = new THREE.BoxGeometry(braceDim, braceLength, braceDim);
        const pos = geom.attributes.position;
        const halfL = braceLength / 2;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            const shearCoord = shearAxis === 'x' ? pos.getX(i) : pos.getZ(i);
            const shearFactor = mirrored ? -1 : 1;
            if (Math.abs(y - halfL) < 1e-5) { pos.setY(i, y - shearFactor * shearCoord); } 
            else if (Math.abs(y + halfL) < 1e-5) { pos.setY(i, y + shearFactor * shearCoord); }
        }
        geom.attributes.position.needsUpdate = true;
        geom.computeVertexNormals();
        return geom;
    };
    
    braces_3d.forEach(b => {
      const geom = createMiteredBraceGeom(b.schenkel, b.dim, b.axis, b.mirrored);
      const brace = new THREE.Mesh(geom, verticalElementMats);
      brace.position.fromArray(b.pos);
      brace.rotation.fromArray(b.rot);
      brace.castShadow = true; brace.receiveShadow = true;
      group.add(brace);
    });
    
    const createRafterMaterial = (angle) => {
        const rotatedTexture = woodMaterial.map.clone();
        rotatedTexture.needsUpdate = true;
        rotatedTexture.rotation = angle;
        rotatedTexture.center.set(0.5, 0.5);
        return new THREE.MeshStandardMaterial({ map: rotatedTexture, roughness: woodMaterial.roughness, metalness: woodMaterial.metalness });
    };

    if (roofType === 'Satteldach') {
        const plateTopY = H;
        const postHeight = plateTopY - BEAM_H;
        if (postHeight <= 0.1) { return group; } 
        const plateCenterY = plateTopY - BEAM_H / 2;

        const postDistributionLength = D - (2 * roofOverhang);
        if (postDistributionLength <= 0.1) { return group; }

        const numPostsPerSideActual = Math.max(2, numberOfPostsPerSide || 2);
        const postZPositions = [];
        if (numPostsPerSideActual > 1) {
            const postSpacing = postDistributionLength / (numPostsPerSideActual - 1);
            for (let i = 0; i < numPostsPerSideActual; i++) {
                postZPositions.push(-postDistributionLength / 2 + i * postSpacing);
            }
        } else {
            postZPositions.push(0); 
        }
        
        const postGeom = new THREE.BoxGeometry(POST_DIM, postHeight, POST_DIM);
        postZPositions.forEach(zPos => {
            const postLeft = new THREE.Mesh(postGeom.clone(), verticalElementMats);
            postLeft.position.set(-post_center_x, postHeight / 2, zPos);
            group.add(postLeft);

            const postRight = new THREE.Mesh(postGeom.clone(), verticalElementMats);
            postRight.position.set(post_center_x, postHeight / 2, zPos);
            group.add(postRight);
        });
        
        const sidePlateGeom = new THREE.BoxGeometry(plateWidth, BEAM_H, D);
        [-post_center_x, post_center_x].forEach(x => {
            const plate = new THREE.Mesh(sidePlateGeom.clone(), zAlignedElementMats);
            plate.position.set(x, plateCenterY, 0);
            group.add(plate);
        });
        
        const tieBeamGeom = new THREE.BoxGeometry(W - POST_DIM, BEAM_H, plateWidth);
        postZPositions.forEach(zPos => {
            const tieBeam = new THREE.Mesh(tieBeamGeom.clone(), xAlignedElementMats);
            tieBeam.position.set(0, plateCenterY, zPos);
            group.add(tieBeam);
        });
        
        const plateInnerX = post_center_x - plateWidth / 2;
        const y_bottom = (x) => -tanA * (Math.abs(x) - plateInnerX) + plateTopY;
        const ridgeNotchDepth = RAFTER_H / 3;
        const ridgeSeatY = y_bottom(BEAM_W / 2) + ridgeNotchDepth;
        const ridgeBeamTopY = ridgeSeatY;
        const ridgeBeamCenterY = ridgeBeamTopY - BEAM_H / 2;

        if (BEAM_W > 0) {
            const ridgeGeom = new THREE.BoxGeometry(D, BEAM_H, BEAM_W);
            const ridgeBeam = new THREE.Mesh(ridgeGeom, xAlignedElementMats);
            ridgeBeam.rotation.y = Math.PI / 2;
            ridgeBeam.position.set(0, ridgeBeamCenterY, 0);
            group.add(ridgeBeam);
        }
        
        const kingPostTopY = ridgeBeamCenterY - BEAM_H / 2;
        const kingPostHeight = kingPostTopY - plateTopY;
        if (kingPostHeight > 0.01) {
            const kingPostGeom = new THREE.BoxGeometry(POST_DIM, kingPostHeight, POST_DIM);
            postZPositions.forEach(zPos => {
                const kingPost = new THREE.Mesh(kingPostGeom.clone(), verticalElementMats);
                kingPost.position.set(0, plateTopY + kingPostHeight / 2, zPos);
                group.add(kingPost);
            });
        }
        
        const middlePurlin_W = middlePurlin ? middlePurlin.w : 0;
        const middlePurlin_H = middlePurlin ? middlePurlin.h : 0;
        let middlePurlinInfoForRafter = null;
    
        if (middlePurlin_W > 0 && middlePurlin_H > 0) {
            const middlePurlin_horizontal_span = plateInnerX - (BEAM_W / 2);
            const middlePurlin_center_x = (BEAM_W / 2) + middlePurlin_horizontal_span / 2;

            const purlinUphillCornerX = middlePurlin_center_x - middlePurlin_W / 2;
            const seatY = y_bottom(purlinUphillCornerX);

            const middlePurlin_center_y = seatY - middlePurlin_H / 2;
            
            middlePurlinInfoForRafter = { centerX: middlePurlin_center_x, width: middlePurlin_W, height: middlePurlin_H, seatY: seatY };

            const middlePurlinGeom = new THREE.BoxGeometry(D, middlePurlin_H, middlePurlin_W);
            [-middlePurlin_center_x, middlePurlin_center_x].forEach(x_pos => {
                const middlePurlinBeam = new THREE.Mesh(middlePurlinGeom.clone(), xAlignedElementMats);
                middlePurlinBeam.rotation.y = Math.PI / 2;
                middlePurlinBeam.position.set(x_pos, middlePurlin_center_y, 0);
                group.add(middlePurlinBeam);
        
                const supportPostBottomY = plateTopY;
                const supportPostTopY = seatY - middlePurlin_H;
                const supportPostHeight = supportPostTopY - supportPostBottomY;

                if (supportPostHeight > 0.01) {
                    const supportPostGeom = new THREE.BoxGeometry(POST_DIM, supportPostHeight, POST_DIM);
                    postZPositions.forEach(zPos => {
                        const supportPost = new THREE.Mesh(supportPostGeom.clone(), verticalElementMats);
                        supportPost.position.set(x_pos, supportPostBottomY + supportPostHeight / 2, zPos);
                        group.add(supportPost);
                    });
                }
            });
        }
        
        const createRafterShape = (isLeft = false, middlePurlinInfo = null) => {
            const sign = isLeft ? -1 : 1;
            const rafterSlopeHeight = RAFTER_H / cosA;
            const ridgeBeamHalfWidth = BEAM_W / 2;
            const x_ridge_plumb = 0;
            const x_ridge_seat_outer = sign * ridgeBeamHalfWidth;
            const x_plate_outer = sign * (post_center_x + plateWidth / 2);
            const x_plate_inner = sign * (post_center_x - plateWidth / 2);
            const x_tail_end = sign * (post_center_x + plateWidth / 2 + roofOverhang);
            
            const y_bottom_abs = (x_abs) => -tanA * (Math.abs(x_abs) - plateInnerX) + plateTopY;
            const y_top_abs = (x_abs) => y_bottom_abs(x_abs) + rafterSlopeHeight;

            const v = {
                p_ridge_top:    { x: x_ridge_plumb, y: y_top_abs(ridgeBeamHalfWidth) },
                p_tail_top:     { x: x_tail_end, y: y_top_abs(Math.abs(x_tail_end)) },
                p_tail_bottom:  { x: x_tail_end, y: y_bottom_abs(Math.abs(x_tail_end)) },
                p_heel_bottom:  { x: x_plate_outer, y: y_bottom_abs(Math.abs(x_plate_outer)) },
                p_heel_top:     { x: x_plate_outer, y: plateTopY },
                p_seat_inner:   { x: x_plate_inner, y: plateTopY },
                p_ridge_notch_outer_bottom: { x: x_ridge_seat_outer, y: y_bottom_abs(Math.abs(x_ridge_seat_outer)) },
                p_ridge_notch_outer_top:    { x: x_ridge_seat_outer, y: ridgeSeatY },
                p_ridge_notch_inner:        { x: x_ridge_plumb, y: ridgeSeatY },
            };
            
            let shapePoints = [
                v.p_ridge_top,
                v.p_tail_top,
                v.p_tail_bottom,
                v.p_heel_bottom,
                v.p_heel_top,
                v.p_seat_inner
            ];

            if (middlePurlinInfo) {
                const { centerX, width, seatY } = middlePurlinInfo;
                const purlin_inner_x = sign * (centerX - width / 2);
                const purlin_outer_x = sign * (centerX + width / 2);

                const p_purlin_plumb_start_bottom = { x: purlin_inner_x, y: y_bottom_abs(Math.abs(purlin_inner_x)) };
                const p_purlin_seat_start = { x: purlin_inner_x, y: seatY };
                const p_purlin_seat_end = { x: purlin_outer_x, y: seatY };
                const p_purlin_plumb_end_bottom = { x: purlin_outer_x, y: y_bottom_abs(Math.abs(purlin_outer_x)) };

                shapePoints.push(p_purlin_plumb_end_bottom);
                shapePoints.push(p_purlin_seat_end);
                shapePoints.push(p_purlin_seat_start);
                shapePoints.push(p_purlin_plumb_start_bottom);
            }
            
            shapePoints.push(v.p_ridge_notch_outer_bottom);
            shapePoints.push(v.p_ridge_notch_outer_top);
            shapePoints.push(v.p_ridge_notch_inner);

            shapePoints = shapePoints.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i-1].x, p.y - arr[i-1].y) > 1e-6);

            const vectorPoints = shapePoints.map(p => new THREE.Vector2(p.x, p.y));
            const shape = new THREE.Shape(vectorPoints);
            return shape;
        };
        
        const rightRafterShape = createRafterShape(false, middlePurlinInfoForRafter);
        const leftRafterShape = createRafterShape(true, middlePurlinInfoForRafter);
        const rafterExtrudeSettings = { depth: RAFTER_W, bevelEnabled: false };
        const rightRafterGeom = new THREE.ExtrudeGeometry(rightRafterShape, rafterExtrudeSettings);
        rightRafterGeom.translate(0, 0, -RAFTER_W / 2);
        const leftRafterGeom = new THREE.ExtrudeGeometry(leftRafterShape, rafterExtrudeSettings);
        leftRafterGeom.translate(0, 0, -RAFTER_W / 2);
        
        const rafterDistributionLength = D;
        const numRafterPairs = Math.max(2, Math.floor(rafterDistributionLength / 0.8) + 1);
        const spacing = (numRafterPairs > 1) ? (rafterDistributionLength - RAFTER_W) / (numRafterPairs - 1) : 0;
        
        for (let i = 0; i < numRafterPairs; i++) {
            const zPos = -rafterDistributionLength / 2 + RAFTER_W / 2 + i * spacing;
            const rafterR = new THREE.Mesh(rightRafterGeom, [createRafterMaterial(-roofAngleRad), endGrainMaterial]);
            rafterR.position.set(0, 0, zPos); group.add(rafterR);
            const rafterL = new THREE.Mesh(leftRafterGeom, [createRafterMaterial(roofAngleRad), endGrainMaterial]);
            rafterL.position.set(0, 0, zPos); group.add(rafterL);
        }
        
        // Traglatten (Horizontal Battens)
        if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0) {
            const rafterSlopeHeight = RAFTER_H / cosA;
            const y_top_abs = (x_abs) => y_bottom(Math.abs(x_abs)) + rafterSlopeHeight;
            
            const p_ridge_top_vec = new THREE.Vector3(0, y_top_abs(BEAM_W / 2), 0);
            const x_tail_end_abs = post_center_x + plateWidth / 2 + roofOverhang;
            const p_tail_top_r_vec = new THREE.Vector3(x_tail_end_abs, y_top_abs(x_tail_end_abs), 0);
            const p_tail_top_l_vec = new THREE.Vector3(-x_tail_end_abs, y_top_abs(x_tail_end_abs), 0);

            const rafterLength = p_ridge_top_vec.distanceTo(p_tail_top_r_vec);
            const BATTEN_SPACING = 0.35;
            const numRowsPerSlope = Math.ceil(rafterLength / BATTEN_SPACING);

            const slopeVecR = new THREE.Vector3().subVectors(p_tail_top_r_vec, p_ridge_top_vec).normalize();
            const slopeVecL = new THREE.Vector3().subVectors(p_tail_top_l_vec, p_ridge_top_vec).normalize();

            const battenGeom = new THREE.BoxGeometry(COUNTER_BATTEN_W, COUNTER_BATTEN_H, D);
            const battenMaterial = zAlignedElementMats;

            for (let i = 0; i < numRowsPerSlope; i++) {
                const distFromRidge = (i + 0.5) * BATTEN_SPACING;
                if (distFromRidge > rafterLength) continue;

                // Right Slope
                const posR = new THREE.Vector3().copy(p_ridge_top_vec).addScaledVector(slopeVecR, distFromRidge);
                const normalR = new THREE.Vector3(tanA, 1, 0).normalize();
                posR.addScaledVector(normalR, COUNTER_BATTEN_H / 2);
                
                const battenR = new THREE.Mesh(battenGeom.clone(), battenMaterial);
                battenR.position.copy(posR);
                battenR.rotation.z = -roofAngleRad;
                group.add(battenR);

                // Left Slope
                const posL = new THREE.Vector3().copy(p_ridge_top_vec).addScaledVector(slopeVecL, distFromRidge);
                const normalL = new THREE.Vector3(-tanA, 1, 0).normalize();
                posL.addScaledVector(normalL, COUNTER_BATTEN_H / 2);
                
                const battenL = new THREE.Mesh(battenGeom.clone(), battenMaterial);
                battenL.position.copy(posL);
                battenL.rotation.z = roofAngleRad;
                group.add(battenL);
            }
        }

    } else if (roofType === 'Pultdach' || roofType === 'Flachdach') {
        const high_post_x = -post_center_x;
        const low_post_x = post_center_x;
        const slope = -tanA;
        const high_purlin_ref_x = high_post_x - BEAM_W / 2;
        const low_purlin_ref_x = low_post_x - BEAM_W / 2;
        const high_purlin_seat_y = H;
        const C = high_purlin_seat_y - slope * high_purlin_ref_x;
        const rafterUndersideY = (x) => slope * x + C;
        const low_purlin_seat_y = rafterUndersideY(low_purlin_ref_x);
        if (low_purlin_seat_y <= 0.1) { return group; } 
        const highPostHeight = high_purlin_seat_y - BEAM_H;
        const lowPostHeight = low_purlin_seat_y - BEAM_H;
        const numPosts = Math.max(2, numberOfPostsPerSide || 2);
        const postDistributionLength = D - (2 * roofOverhang);
        if (postDistributionLength <= 0.1) { return group; }
        const zPositions = [];
        if (numPosts === 1) {
            zPositions.push(0);
        } else {
            const spacing = postDistributionLength / (numPosts - 1);
            for (let i = 0; i < numPosts; i++) {
                zPositions.push(-postDistributionLength / 2 + i * spacing);
            }
        }
        
        const highPostGeom = new THREE.BoxGeometry(POST_DIM, highPostHeight, POST_DIM);
        const lowPostGeom = new THREE.BoxGeometry(POST_DIM, lowPostHeight, POST_DIM);
        zPositions.forEach(z => {
            const highPost = new THREE.Mesh(highPostGeom.clone(), verticalElementMats);
            highPost.position.set(high_post_x, highPostHeight / 2, z);
            group.add(highPost);
            const lowPost = new THREE.Mesh(lowPostGeom.clone(), verticalElementMats);
            lowPost.position.set(low_post_x, lowPostHeight / 2, z);
            group.add(lowPost);
        });

        const purlinGeom = new THREE.BoxGeometry(BEAM_W, BEAM_H, D);
        const highPurlin = new THREE.Mesh(purlinGeom.clone(), zAlignedElementMats);
        highPurlin.position.set(high_post_x, high_purlin_seat_y - BEAM_H / 2, 0);
        group.add(highPurlin);
        const lowPurlin = new THREE.Mesh(purlinGeom.clone(), zAlignedElementMats);
        lowPurlin.position.set(low_post_x, low_purlin_seat_y - BEAM_H / 2, 0);
        group.add(lowPurlin);
        
        const crossMemberGeom = new THREE.BoxGeometry(W - POST_DIM, TIE_BEAM_H, BEAM_W);
        const zange_y = low_purlin_seat_y - TIE_BEAM_H / 2;
        
        zPositions.forEach(z => {
            const crossMember = new THREE.Mesh(crossMemberGeom.clone(), xAlignedElementMats);
            crossMember.position.set(0, zange_y, z);
            group.add(crossMember);
        });

        let middlePurlinInfoForPultRafter = null;
        if (middlePurlin && middlePurlin.w > 0 && middlePurlin.h > 0) {
            const middlePurlin_center_x = 0;
            const purlinUphillCornerX = middlePurlin_center_x - middlePurlin.w / 2;
            const seatY = rafterUndersideY(purlinUphillCornerX);
            const middlePurlin_top_y = seatY;
            const middlePurlin_center_y = middlePurlin_top_y - middlePurlin.h / 2;
            
            middlePurlinInfoForPultRafter = { centerX: middlePurlin_center_x, width: middlePurlin.w, height: middlePurlin.h, seatY: seatY };

            const middlePurlinGeom = new THREE.BoxGeometry(D, middlePurlin.h, middlePurlin.w);
            const middlePurlinBeam = new THREE.Mesh(middlePurlinGeom, xAlignedElementMats);
            middlePurlinBeam.rotation.y = Math.PI / 2;
            middlePurlinBeam.position.set(middlePurlin_center_x, middlePurlin_center_y, 0);
            group.add(middlePurlinBeam);

            const supportPostBottomY = zange_y + TIE_BEAM_H / 2;
            const supportPostTopY = middlePurlin_top_y - middlePurlin.h;
            const supportPostHeight = supportPostTopY - supportPostBottomY;

            if (supportPostHeight > 0.01) {
                const supportPostGeom = new THREE.BoxGeometry(POST_DIM, supportPostHeight, POST_DIM);
                zPositions.forEach(zPos => {
                    const supportPost = new THREE.Mesh(supportPostGeom, verticalElementMats);
                    supportPost.position.set(middlePurlin_center_x, supportPostBottomY + supportPostHeight / 2, zPos);
                    group.add(supportPost);
                });
            }
        }
        
        const createSlopedRafterShape = (middlePurlinInfo = null) => {
            const rafterSlopeHeight = RAFTER_H / cosA;
            const y_top = (x) => rafterUndersideY(x) + rafterSlopeHeight;
            const high_purlin_x_inner = high_post_x + BEAM_W / 2;
            const high_purlin_x_outer = high_post_x - BEAM_W / 2;
            const low_purlin_x_inner = low_post_x - BEAM_W / 2;
            const low_purlin_x_outer = low_post_x + BEAM_W / 2;
            const x_rafter_end_high = high_purlin_x_outer - roofOverhang;
            const x_rafter_end_low = low_purlin_x_outer + roofOverhang;

            const bottomPath = [];
            bottomPath.push({x:high_purlin_x_inner, y: rafterUndersideY(high_purlin_x_inner)});
            bottomPath.push({x:high_purlin_x_inner, y: high_purlin_seat_y});
            bottomPath.push({x:high_purlin_x_outer, y: high_purlin_seat_y});
            bottomPath.push({x:high_purlin_x_outer, y: rafterUndersideY(high_purlin_x_outer)});

            if (middlePurlinInfo) {
                const { centerX, width, seatY } = middlePurlinInfo;
                const purlin_inner_x = centerX - width / 2;
                const purlin_outer_x = centerX + width / 2;
                bottomPath.push({ x: purlin_inner_x, y: rafterUndersideY(purlin_inner_x) });
                bottomPath.push({ x: purlin_inner_x, y: seatY });
                bottomPath.push({ x: purlin_outer_x, y: seatY });
                bottomPath.push({ x: purlin_outer_x, y: rafterUndersideY(purlin_outer_x) });
            }
            
            bottomPath.push({x:low_purlin_x_inner, y: rafterUndersideY(low_purlin_x_inner)});
            bottomPath.push({x:low_purlin_x_inner, y: low_purlin_seat_y});
            bottomPath.push({x:low_purlin_x_outer, y: low_purlin_seat_y});
            bottomPath.push({x:low_purlin_x_outer, y: rafterUndersideY(low_purlin_x_outer)});

            const shapePoints = [
                {x:x_rafter_end_high, y: y_top(x_rafter_end_high)}, 
                {x:x_rafter_end_low, y: y_top(x_rafter_end_low)},
                {x:x_rafter_end_low, y: rafterUndersideY(x_rafter_end_low)}, 
                ...bottomPath.reverse(),
                {x:x_rafter_end_high, y: rafterUndersideY(x_rafter_end_high)},
            ].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i-1].x, p.y - arr[i-1].y) > 1e-6);

            const vectorPoints = shapePoints.map(p => new THREE.Vector2(p.x, p.y));
            const shape = new THREE.Shape(vectorPoints);
            
            return { shape, angle: slope };
        };
        
        const { shape: rafterShape, angle: actualRafterAngle } = createSlopedRafterShape(middlePurlinInfoForPultRafter);
        const rafterGeom = new THREE.ExtrudeGeometry(rafterShape, { depth: RAFTER_W, bevelEnabled: false });
        rafterGeom.translate(0, 0, -RAFTER_W/2);
        const rafterDistributionLength = D;
        const numRafters = Math.max(2, Math.floor(rafterDistributionLength / 0.8) + 1);
        const spacing = (numRafters > 1) ? (rafterDistributionLength - RAFTER_W) / (numRafters - 1) : 0;
        const firstRafterZ = -rafterDistributionLength / 2 + RAFTER_W / 2;
        
        for (let i = 0; i < numRafters; i++) {
            const zPos = firstRafterZ + i * spacing;
            const rafter = new THREE.Mesh(rafterGeom.clone(), [createRafterMaterial(actualRafterAngle), endGrainMaterial]);
            rafter.position.set(0, 0, zPos);
            group.add(rafter);
        }

        // Traglatten (Horizontal Battens) for Pultdach
        if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0) {
            const rafterSlopeHeight = RAFTER_H / cosA;
            const y_top = (x) => rafterUndersideY(x) + rafterSlopeHeight;
            const high_purlin_x_outer = high_post_x - BEAM_W / 2;
            const low_purlin_x_outer = low_post_x + BEAM_W / 2;
            const x_rafter_end_high = high_purlin_x_outer - roofOverhang;
            const x_rafter_end_low = low_purlin_x_outer + roofOverhang;
            
            const p_high_end_top_vec = new THREE.Vector3(x_rafter_end_high, y_top(x_rafter_end_high), 0);
            const p_low_end_top_vec = new THREE.Vector3(x_rafter_end_low, y_top(x_rafter_end_low), 0);
            
            const rafterLength = p_high_end_top_vec.distanceTo(p_low_end_top_vec);
            const BATTEN_SPACING = 0.35;
            const numRows = Math.ceil(rafterLength / BATTEN_SPACING);

            const battenGeom = new THREE.BoxGeometry(COUNTER_BATTEN_W, COUNTER_BATTEN_H, D);
            const battenMaterial = zAlignedElementMats;
            
            const slopeVec = new THREE.Vector3().subVectors(p_low_end_top_vec, p_high_end_top_vec).normalize();

            for (let i = 0; i < numRows; i++) {
                const distFromHighEnd = (i + 0.5) * BATTEN_SPACING;
                if (distFromHighEnd > rafterLength) continue;

                const pos = new THREE.Vector3().copy(p_high_end_top_vec).addScaledVector(slopeVec, distFromHighEnd);
                
                const normalVec = new THREE.Vector3(-(-slope), 1, 0).normalize();
                pos.addScaledVector(normalVec, COUNTER_BATTEN_H / 2);

                const batten = new THREE.Mesh(battenGeom.clone(), battenMaterial);
                batten.position.copy(pos);
                batten.rotation.z = -roofAngleRad;
                group.add(batten);
            }
        }
    }
    
    // --- START Dimensioning Code ---
    const dimensionsGroup = new THREE.Group();
    dimensionsGroup.name = "dimensionsGroup";
    group.add(dimensionsGroup);

    const createDimensionLabel = (text, position, options = {}) => {
        const { bgColor = 'rgba(255, 255, 255, 0.85)', textColor = '#c0392b', fontSize = 48 } = options;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const font = '500 ' + fontSize + 'px "Inter", sans-serif';
        context.font = font;
        const textMetrics = context.measureText(text);
        const padding = { x: 20, y: 10 };
        canvas.width = textMetrics.width + padding.x * 2;
        canvas.height = fontSize + padding.y * 2;
        context.fillStyle = bgColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = font;
        context.fillStyle = textColor;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(canvas.width / 150, canvas.height / 150, 1.0);
        sprite.position.copy(position);
        sprite.renderOrder = 999;
        return sprite;
    };

    const createDimensionLine = (p1_world, p2_world, text, offsetDir_world, offsetDist, options = {}) => {
        const { color = 0xc0392b, tickLength = 0.2, labelOffset = 0.25 } = options;
        const dimGroup = new THREE.Group();
        const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 });
        const p1 = p1_world.clone();
        const p2 = p2_world.clone();
        const offsetDir = offsetDir_world.clone().normalize();
        const p1_dim = p1.clone().addScaledVector(offsetDir, offsetDist);
        const p2_dim = p2.clone().addScaledVector(offsetDir, offsetDist);
        dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p1_dim]), lineMaterial));
        dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p2, p2_dim]), lineMaterial));
        const lineDir = p2_dim.clone().sub(p1_dim).normalize();
        const arrowMaterial = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 });
        const arrowGeom = new THREE.ConeGeometry(0.05, 0.2, 8);
        arrowGeom.translate(0, -0.1, 0);
        const arrow1 = new THREE.Mesh(arrowGeom, arrowMaterial);
        arrow1.position.copy(p1_dim);
        arrow1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lineDir);
        dimGroup.add(arrow1);
        const arrow2 = new THREE.Mesh(arrowGeom, arrowMaterial);
        arrow2.position.copy(p2_dim);
        arrow2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lineDir.clone().negate());
        dimGroup.add(arrow2);
        const lineStart = p1_dim.clone().addScaledVector(lineDir, 0.2);
        const lineEnd = p2_dim.clone().addScaledVector(lineDir, -0.2);
        dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([lineStart, lineEnd]), lineMaterial));
        const labelPos = p1_dim.clone().add(p2_dim).multiplyScalar(0.5).addScaledVector(offsetDir, labelOffset);
        dimGroup.add(createDimensionLabel(text, labelPos));
        dimGroup.renderOrder = 999;
        return dimGroup;
    };
    
    if (roofType === 'Satteldach') {
        const plateTopY = H;
        const plateInnerX = post_center_x - plateWidth / 2;
        const y_bottom = (x) => -tanA * (Math.abs(x) - plateInnerX) + plateTopY;
        const rafterSlopeHeight = RAFTER_H / cosA;
        const y_top = (x) => y_bottom(x) + rafterSlopeHeight;
        const ridgeHeight = y_top(0);
        
        const ridgeNotchDepth = RAFTER_H / 3;
        const ridgeSeatY = y_bottom(BEAM_W / 2) + ridgeNotchDepth;
        const ridgeBeamTopY = ridgeSeatY;
        const ridgeBeamCenterY = ridgeBeamTopY - BEAM_H / 2;
        
        const kingPostTopY = ridgeBeamCenterY - BEAM_H / 2;
        const totalWidth = 2 * (post_center_x + plateWidth / 2 + roofOverhang);
        
        const postDistributionLength = D - (2 * roofOverhang);
        const numPostsPerSideActual = Math.max(2, numberOfPostsPerSide || 2);
        const postZPositions = [];
        if (numPostsPerSideActual > 1) {
            const postSpacing = postDistributionLength / (numPostsPerSideActual - 1);
            for (let i = 0; i < numPostsPerSideActual; i++) {
                postZPositions.push(-postDistributionLength / 2 + i * postSpacing);
            }
        } else {
            postZPositions.push(0); 
        }

        const innerDepth = postZPositions.length > 1 ? postDistributionLength - POST_DIM : 0;
        const side_x = totalWidth/2 + 1;
        const front_z = D/2 + 1.5;

        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, 0), new THREE.Vector3(side_x, ridgeHeight, 0), 'First: ' + ridgeHeight.toFixed(2) + 'm', offset_x_pos, 0));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, 0), new THREE.Vector3(side_x, plateTopY, 0), 'Traufe: ' + plateTopY.toFixed(2) + 'm', offset_x_pos, -0.75));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(-totalWidth / 2, -0.5, front_z), new THREE.Vector3(totalWidth / 2, -0.5, front_z), 'Breite: ' + totalWidth.toFixed(2) + 'm', offset_y_neg, 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, -0.5, -D / 2), new THREE.Vector3(side_x, -0.5, D / 2), 'Tiefe: ' + D.toFixed(2) + 'm', offset_y_neg, 0.5));
        const innerWidth = W - POST_DIM;
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(-innerWidth / 2, 0, front_z), new THREE.Vector3(innerWidth / 2, 0, front_z), 'Breite Innen: ' + innerWidth.toFixed(2) + 'm', offset_z_pos, 0));
        if (innerDepth > 0) dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, -innerDepth/2), new THREE.Vector3(side_x, 0, innerDepth/2), 'Tiefe Innen: ' + innerDepth.toFixed(2) + 'm', offset_x_pos, 0.5));
        const lowestClearance = plateTopY - BEAM_H;
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(0, 0, front_z), new THREE.Vector3(0, lowestClearance, front_z), 'Lichte Höhe tief: ' + lowestClearance.toFixed(2) + 'm', offset_x_pos, 0));
        if (kingPostTopY > lowestClearance) dimensionsGroup.add(createDimensionLine(new THREE.Vector3(0, 0, front_z), new THREE.Vector3(0, kingPostTopY, front_z), 'Lichte Höhe First: ' + kingPostTopY.toFixed(2) + 'm', offset_x_pos, 0.5));

    } else { // Pultdach / Flachdach
        const high_post_x = -post_center_x; const low_post_x = post_center_x;
        const slope = -tanA;
        const high_purlin_ref_x = high_post_x - BEAM_W / 2;
        const C = H - slope * high_purlin_ref_x;
        const rafterUndersideY = (x) => slope * x + C;
        const rafterSlopeHeight = RAFTER_H / cosA;
        const y_top = (x) => rafterUndersideY(x) + rafterSlopeHeight;
        const x_rafter_end_high = high_post_x - BEAM_W / 2 - roofOverhang;
        const x_rafter_end_low = low_post_x + BEAM_W / 2 + roofOverhang;
        const totalWidth = x_rafter_end_low - x_rafter_end_high;
        const side_x = totalWidth/2 + 2;
        const front_z = D/2 + 1.5;
        const highestY = y_top(x_rafter_end_high);
        const highEavesY = H;
        const lowEavesY = rafterUndersideY(low_post_x - BEAM_W / 2);
        
        const numPosts = Math.max(2, numberOfPostsPerSide || 2);
        const postDistributionLength = D - (2 * roofOverhang);
        const zPositions = [];
        if (numPosts > 1) {
            const spacing = postDistributionLength / (numPosts - 1);
            for (let i = 0; i < numPosts; i++) {
                zPositions.push(-postDistributionLength / 2 + i * spacing);
            }
        } else {
            zPositions.push(0);
        }

        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(x_rafter_end_high, 0, 0), new THREE.Vector3(x_rafter_end_high, highestY, 0), 'First: ' + highestY.toFixed(2) + 'm', offset_x_pos.clone().negate(), 0));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(high_post_x, 0, 0), new THREE.Vector3(high_post_x, highEavesY, 0), 'Traufe Hoch: ' + highEavesY.toFixed(2) + 'm', offset_x_pos.clone().negate(), -0.75));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(low_post_x, 0, 0), new THREE.Vector3(low_post_x, lowEavesY, 0), 'Traufe Tief: ' + lowEavesY.toFixed(2) + 'm', offset_x_pos, 0));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(x_rafter_end_high, -0.5, front_z), new THREE.Vector3(x_rafter_end_low, -0.5, front_z), 'Breite: ' + totalWidth.toFixed(2) + 'm', offset_y_neg, 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, -0.5, -D / 2), new THREE.Vector3(side_x, -0.5, D / 2), 'Tiefe: ' + D.toFixed(2) + 'm', offset_y_neg, 0.5));
        const innerWidth = W - POST_DIM;
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(-innerWidth / 2, 0, front_z), new THREE.Vector3(innerWidth / 2, 0, front_z), 'Breite Innen: ' + innerWidth.toFixed(2) + 'm', offset_z_pos, 0));
        const innerDepth = zPositions.length > 1 ? postDistributionLength - POST_DIM : 0;
        if(innerDepth > 0) dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, -innerDepth/2), new THREE.Vector3(side_x, 0, innerDepth/2), 'Tiefe Innen: ' + innerDepth.toFixed(2) + 'm', offset_x_pos, 0.5));
        const zange_y = lowEavesY - TIE_BEAM_H / 2;
        const lowestClearance = zange_y - TIE_BEAM_H / 2;
        const highestClearance = rafterUndersideY(high_post_x + POST_DIM / 2);
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(low_post_x, 0, front_z), new THREE.Vector3(low_post_x, lowestClearance, front_z), 'Lichte Höhe tief: ' + lowestClearance.toFixed(2) + 'm', offset_x_pos, 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(high_post_x, 0, front_z), new THREE.Vector3(high_post_x, highestClearance, front_z), 'Lichte Höhe hoch: ' + highestClearance.toFixed(2) + 'm', offset_x_pos.clone().negate(), 0.5));
    }
    // --- END Dimensioning Code ---

    if (roofType === 'Pultdach' || roofType === 'Flachdach') {
        const rotatedPivot = new THREE.Group();
        rotatedPivot.name = "rotatedPivot";
        rotatedPivot.rotation.y = Math.PI;

        const dims = group.getObjectByName("dimensionsGroup");
        if (dims) {
            group.remove(dims);
        }
        
        while(group.children.length > 0) {
            rotatedPivot.add(group.children[0]);
        }

        group.add(rotatedPivot);
        if (dims) {
            group.add(dims);
        }
    }

    return group;
  `;
    
    return {
        mainModelCode,
        partsList: Array.from(parts.values()),
    };
}
