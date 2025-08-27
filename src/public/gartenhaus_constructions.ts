import * as THREE from 'three';
import { RoofType, PartInfo, DrawingInfo, Dimension, Marker, ReferenceLine } from './types.js';
import { getDrawingInfo, createBoxDrawingInfo, calculateStudLayout, generateStudMarkings, createGartenhausBraceInfo, createGartenhausSatteldachRafterDrawing, optimizeCuttingList } from './drawingUtils.js';

/**
 * Erstellt den JavaScript-Code für das 3D-Modell sowie eine exakte Stückliste mit 2D-Zeichnungsinformationen für ein Gartenhaus.
 */
export const generateGartenhausPlan = (params: {
  W: number, D: number, H: number, roofType: RoofType, roofOverhang: number, roofPitch: number,
  BEAM_W: number, BEAM_H: number, RAFTER_W: number, RAFTER_H: number, BRACE_DIM: number, STUD_D: number,
  COUNTER_BATTEN_W: number, COUNTER_BATTEN_H: number,
  middlePurlin: { w: number, h: number } | null,
  useKingPosts: boolean,
  numberOfPostsPerSide?: number,
}) => {
    const { W, D, H, roofType, roofOverhang, roofPitch, BEAM_W, BEAM_H, RAFTER_W, RAFTER_H, BRACE_DIM, STUD_D, COUNTER_BATTEN_W, COUNTER_BATTEN_H, middlePurlin, useKingPosts } = params;

    const parts = new Map<string, PartInfo>();
    const STUD_THICKNESS = 0.055; // 55mm
    const SILL_H = 0.08; // 80mm
    const SILL_W = STUD_D;
    const TOP_PLATE_H = BEAM_H > 0.1 ? BEAM_H : 0.12;
    const TOP_PLATE_W = BEAM_W > 0.08 ? BEAM_W : 0.10;

    const addPart = (key: string, partInfo: Omit<PartInfo, 'key'>) => {
        if (partInfo.quantity <= 0) return;
        const existing = parts.get(key);
        if (!existing) {
            parts.set(key, { ...partInfo, key });
        } else {
            existing.quantity += partInfo.quantity;
        }
    };

    // --- Wall Framing ---
    const wallHeight = H - SILL_H - TOP_PLATE_H;
    const studDesc = `Ständer ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm, Länge: ${(wallHeight*100).toFixed(1)}cm`;
    const studDrawing = createBoxDrawingInfo(wallHeight, STUD_D, STUD_THICKNESS);
    const standardStudSpacing = 0.625;

    // Gable walls (along W, fit between side walls)
    const gableWallLength = W - 2 * STUD_D;
    const gableLayout = calculateStudLayout(gableWallLength, STUD_THICKNESS, standardStudSpacing);
    addPart('stud_gable', { description: studDesc, drawingInfo: studDrawing, quantity: gableLayout.positions.length * 2 });
    
    // Side walls (along D, run full length)
    const sideLayout = calculateStudLayout(D, STUD_THICKNESS, standardStudSpacing);
    addPart('stud_side', { description: studDesc, drawingInfo: studDrawing, quantity: sideLayout.positions.length * 2 });

    // --- Sills (parts list) ---
    const { markers: sideWallMarkers, dimensions: sideWallDims } = generateStudMarkings(sideLayout, SILL_H);
    const sillSideDesc = `Schwelle Längsseite ${(SILL_W*100).toFixed(1)}x${(SILL_H*100).toFixed(1)}cm, Länge: ${(D*100).toFixed(1)}cm`;
    addPart('sill_d', { description: sillSideDesc, drawingInfo: createBoxDrawingInfo(D, SILL_H, SILL_W, sideWallDims, sideWallMarkers), quantity: 2 });
    
    const { markers: gableWallMarkers, dimensions: gableWallDims } = generateStudMarkings(gableLayout, SILL_H);
    const sillGableDesc = `Schwelle Stirnseite ${(SILL_W*100).toFixed(1)}x${(SILL_H*100).toFixed(1)}cm, Länge: ${(gableWallLength*100).toFixed(1)}cm`;
    addPart('sill_w', { description: sillGableDesc, drawingInfo: createBoxDrawingInfo(gableWallLength, SILL_H, SILL_W, gableWallDims, gableWallMarkers), quantity: 2 });
    
    let braceParams = {
        gable: { first: { run: 0, length: 0, angle: 0 }, last: { run: 0, length: 0, angle: 0 } },
        side: { first: { run: 0, length: 0, angle: 0 }, last: { run: 0, length: 0, angle: 0 } }
    };

    // --- Braces ---
    // Gable braces (on edge)
    if (gableLayout.spacings.length > 0) {
        const firstBayWidth = gableLayout.spacings[0] - STUD_THICKNESS;
        if (firstBayWidth > STUD_THICKNESS * 0.5) {
            const { drawingInfo, outerLength, angleRad, description } = createGartenhausBraceInfo(firstBayWidth, wallHeight, STUD_THICKNESS, STUD_D, STUD_THICKNESS);
            braceParams.gable.first = { run: firstBayWidth, length: outerLength, angle: angleRad };
            const fullDesc = `Strebe Giebelwand (Feld 1) ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm, L: ${(outerLength*100).toFixed(1)}cm`;
            addPart(`brace_gable_bay1_${Math.round(firstBayWidth*1000)}`, { description: fullDesc, drawingInfo: drawingInfo, quantity: 2 }); // 2 walls, left brace
        }
        if (gableLayout.spacings.length > 1) {
            const lastBayWidth = gableLayout.spacings[gableLayout.spacings.length - 1] - STUD_THICKNESS;
            if (lastBayWidth > STUD_THICKNESS * 0.5) {
                const { drawingInfo, outerLength, angleRad, description } = createGartenhausBraceInfo(lastBayWidth, wallHeight, STUD_THICKNESS, STUD_D, STUD_THICKNESS);
                braceParams.gable.last = { run: lastBayWidth, length: outerLength, angle: angleRad };
                const fullDesc = `Strebe Giebelwand (letztes Feld) ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm, L: ${(outerLength*100).toFixed(1)}cm`;
                addPart(`brace_gable_bay_last_${Math.round(lastBayWidth*1000)}`, { description: fullDesc, drawingInfo: drawingInfo, quantity: 2 }); // 2 walls, right brace
            }
        }
    }

    // Side braces
    if (sideLayout.spacings.length > 0) {
        const firstBayWidth = sideLayout.spacings[0] - STUD_THICKNESS;
        if (firstBayWidth > STUD_THICKNESS * 0.5) {
            const { drawingInfo, outerLength, angleRad, description } = createGartenhausBraceInfo(firstBayWidth, wallHeight, STUD_THICKNESS, STUD_D, STUD_THICKNESS);
            braceParams.side.first = { run: firstBayWidth, length: outerLength, angle: angleRad };
            const fullDesc = `Strebe Längswand (Feld 1) ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm, L: ${(outerLength*100).toFixed(1)}cm`;
            addPart(`brace_side_bay1_${Math.round(firstBayWidth*1000)}`, { description: fullDesc, drawingInfo: drawingInfo, quantity: 2 });
        }
        if (sideLayout.spacings.length > 1) {
            const lastBayWidth = sideLayout.spacings[sideLayout.spacings.length - 1] - STUD_THICKNESS;
             if (lastBayWidth > STUD_THICKNESS * 0.5) {
                const { drawingInfo, outerLength, angleRad, description } = createGartenhausBraceInfo(lastBayWidth, wallHeight, STUD_THICKNESS, STUD_D, STUD_THICKNESS);
                braceParams.side.last = { run: lastBayWidth, length: outerLength, angle: angleRad };
                const fullDesc = `Strebe Längswand (letztes Feld) ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm, L: ${(outerLength*100).toFixed(1)}cm`;
                addPart(`brace_side_bay_last_${Math.round(lastBayWidth*1000)}`, { description: fullDesc, drawingInfo: drawingInfo, quantity: 2 });
            }
        }
    }


    // --- Top Plates, Ceiling Joists, and Roof ---
    const plateTopY = H;
    const rafterAndJoistTotalCount = Math.max(2, Math.floor(D / 0.8) + 1);
    
    // Top plates (Fußpfetten/Rähme)
    const sidePlateLength = D + 2 * roofOverhang;
    const { markers: topPlateSideMarkers, dimensions: topPlateSideDims } = generateStudMarkings(sideLayout, TOP_PLATE_H, roofOverhang);
    const topPlateSideDesc = `Fusspfette Längsseite ${(TOP_PLATE_W*100).toFixed(1)}x${(TOP_PLATE_H*100).toFixed(1)}cm, Länge: ${(sidePlateLength*100).toFixed(1)}cm`;
    addPart('top_plate_d', { description: topPlateSideDesc, drawingInfo: createBoxDrawingInfo(sidePlateLength, TOP_PLATE_H, TOP_PLATE_W, topPlateSideDims, topPlateSideMarkers), quantity: 2 });
    
    const { markers: topPlateGableMarkers, dimensions: topPlateGableDims } = generateStudMarkings(gableLayout, TOP_PLATE_H);
    const topPlateGableDesc = `Rähm Stirnseite ${(TOP_PLATE_W*100).toFixed(1)}x${(TOP_PLATE_H*100).toFixed(1)}cm`;
    addPart('top_plate_w', { description: topPlateGableDesc, drawingInfo: createBoxDrawingInfo(gableWallLength, TOP_PLATE_H, TOP_PLATE_W, topPlateGableDims, topPlateGableMarkers), quantity: 2 });
    
    if (useKingPosts) {
      // Ceiling Joists (Zangen)
      const ceilingJoistLength = W - 2 * TOP_PLATE_W;
      const ceilingJoistDesc = `Deckenträger/Zange ${(RAFTER_W*100).toFixed(1)}x${(TOP_PLATE_H*100).toFixed(1)}cm, Länge: ${(ceilingJoistLength*100).toFixed(1)}cm`;
      parts.set('ceiling_joist', { 
          key: 'ceiling_joist', 
          quantity: rafterAndJoistTotalCount, 
          description: ceilingJoistDesc, 
          drawingInfo: createBoxDrawingInfo(ceilingJoistLength, TOP_PLATE_H, RAFTER_W),
          statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''}
      });
    }
    
    let rafterLength = 0;

    if (roofType === 'Satteldach') {
        const ridgePurlinLength = D + 2*roofOverhang;
        const ridgePurlinDesc = `Firstpfette ${(BEAM_W*100).toFixed(1)}x${(BEAM_H*100).toFixed(1)}cm, Länge: ${(ridgePurlinLength*100).toFixed(1)}cm`;
        parts.set('ridge_beam', { key: 'ridge_beam', quantity: 1, description: ridgePurlinDesc, drawingInfo: createBoxDrawingInfo(ridgePurlinLength, BEAM_H, BEAM_W), statics: { passed: false, span: 0, load: 0, maxDeflection: 0, allowedDeflection: 0, inertia:0, eModulus:0, formula:'', formulaDescription:''} });

        const roofAngleRad = (roofPitch * Math.PI) / 180;
        const tanA = Math.tan(roofAngleRad);
        const ridgeBeamHalfWidth = BEAM_W / 2;
        const plateInnerX = W / 2 - TOP_PLATE_W;
        const y_bottom_abs_saddle = (x:number) => -tanA * (Math.abs(x) - plateInnerX) + plateTopY;
        const ridgeNotchDepth = RAFTER_H / 3;
        const ridgeSeatY = y_bottom_abs_saddle(ridgeBeamHalfWidth) + ridgeNotchDepth;
        const ridgeBeamCenterY = ridgeSeatY - BEAM_H / 2;
        const ridgeBeamBottomY = ridgeBeamCenterY - BEAM_H / 2;

        if (useKingPosts) {
            const kingPostBottomY = plateTopY; // Sits on joist/plate
            const kingPostTopY = ridgeBeamBottomY;
            const kingPostHeight = kingPostTopY - kingPostBottomY;
            if (kingPostHeight > 0.1) {
                 const desc = `First-Stütze ${(RAFTER_W*100).toFixed(1)}x${(BEAM_W*100).toFixed(1)}cm, Länge: ${(kingPostHeight*100).toFixed(1)}cm`;
                 addPart('king_post', { description: desc, drawingInfo: createBoxDrawingInfo(kingPostHeight, BEAM_W, RAFTER_W), quantity: rafterAndJoistTotalCount });
            }
        }
        
        // Gable end support posts
        const gablePostHeight = ridgeBeamBottomY - H;
        if (gablePostHeight > 0.1) {
             const gablePostDrawing = createBoxDrawingInfo(gablePostHeight, STUD_D, STUD_THICKNESS);
             const desc = `Giebel-Stützpfosten ${(STUD_D*100).toFixed(1)}x${(STUD_THICKNESS*100).toFixed(1)}cm`;
             addPart('gable_post', { description: desc, drawingInfo: gablePostDrawing, quantity: 2 });
        }

        const { drawingInfo: rafterDrawing, totalLength } = createGartenhausSatteldachRafterDrawing(W, TOP_PLATE_W, H, roofOverhang, roofPitch, BEAM_W, RAFTER_H, RAFTER_W);
        rafterLength = totalLength;
        const rafterAndJoistSpacing = (rafterAndJoistTotalCount > 1) ? (D - RAFTER_W) / (rafterAndJoistTotalCount - 1) : 0;
        const numTotalRafters = rafterAndJoistTotalCount + Math.max(0, Math.ceil(2 * roofOverhang / rafterAndJoistSpacing) - 2);
        const desc = `Sparren ${(RAFTER_W*100).toFixed(1)}x${(RAFTER_H*100).toFixed(1)}cm`;
        addPart('rafter', { description: desc, drawingInfo: rafterDrawing, quantity: numTotalRafters * 2 });
    } // TODO: Add Pultdach/Flachdach logic

    // Counter Battens
    if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0 && rafterLength > 0.1) {
        const BATTEN_SPACING = 0.35;
        const numRowsPerSlope = Math.ceil(rafterLength / BATTEN_SPACING);
        const battenRowLength = D + 2 * roofOverhang;
        const allCuts = Array(numRowsPerSlope * (roofType === 'Satteldach' ? 2 : 1)).fill(battenRowLength);
        
        if (allCuts.length > 0) {
            const stockLength = 5.0;
            const kerf = 0.005;
            const { plan, summaryText } = optimizeCuttingList(allCuts, stockLength, kerf);
            const numStock = plan.bins.reduce((sum, bin) => sum + bin.count, 0);

            let desc = `Traglatten ${Math.round(COUNTER_BATTEN_W * 1000)}x${Math.round(COUNTER_BATTEN_H * 1000)}mm (${numStock} x 5m Stangen)`;
            if(summaryText) desc += `\n\n${summaryText}`;
            
            addPart('counter_batten', { description: desc, quantity: 1, cuttingPlan: plan });
        }
    }
    
    // --- Generate 3D Model Code ---
    const mainModelCode = `
    const { W, D, H, roofType, roofOverhang, roofPitch, BEAM_W, BEAM_H, RAFTER_W, RAFTER_H, STUD_D, BRACE_DIM, useKingPosts, middlePurlin, wallHeight, gableLayout, sideLayout, standardStudSpacing, gableWallLength, COUNTER_BATTEN_W, COUNTER_BATTEN_H, TOP_PLATE_W, SILL_H, braceParams } = {
      W: ${W}, D: ${D}, H: ${H}, roofType: '${roofType}', roofOverhang: ${roofOverhang}, roofPitch: ${roofPitch},
      BEAM_W: ${BEAM_W}, BEAM_H: ${BEAM_H}, RAFTER_W: ${RAFTER_W}, RAFTER_H: ${RAFTER_H}, STUD_D: ${STUD_D}, BRACE_DIM: ${BRACE_DIM},
      COUNTER_BATTEN_W: ${COUNTER_BATTEN_W}, COUNTER_BATTEN_H: ${COUNTER_BATTEN_H},
      useKingPosts: ${useKingPosts}, middlePurlin: ${JSON.stringify(middlePurlin)},
      wallHeight: ${wallHeight},
      gableLayout: ${JSON.stringify(gableLayout)},
      sideLayout: ${JSON.stringify(sideLayout)},
      standardStudSpacing: ${standardStudSpacing},
      gableWallLength: ${gableWallLength},
      TOP_PLATE_W: ${TOP_PLATE_W},
      SILL_H: ${SILL_H},
      braceParams: ${JSON.stringify(braceParams)}
    };

    const group = new THREE.Group();
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const tanA = Math.tan(roofAngleRad);
    const cosA = Math.cos(roofAngleRad);
    const SILL_W = ${SILL_W};
    const TOP_PLATE_H = ${TOP_PLATE_H};
    const STUD_THICKNESS = ${STUD_THICKNESS};
    
    const verticalElementMats = [woodMaterialVertical, woodMaterialVertical, endGrainMaterial, endGrainMaterial, woodMaterialVertical, woodMaterialVertical];
    const xAlignedElementMats = [endGrainMaterial, endGrainMaterial, woodMaterial, woodMaterial, woodMaterial, woodMaterial];
    const zAlignedElementMats = [woodMaterial, woodMaterial, woodMaterial, woodMaterial, endGrainMaterial, endGrainMaterial];
    
    // --- Wall Frames (Sills, Studs, Top Plates per wall for modular assembly) ---
    const sillY = SILL_H / 2;
    const studY = SILL_H + wallHeight / 2;
    const topPlateY = SILL_H + wallHeight + TOP_PLATE_H / 2;
    
    // Side Walls (Left and Right - run full depth)
    const sideWallGroup = new THREE.Group();
    const sill_d_geom = new THREE.BoxGeometry(SILL_W, SILL_H, D);
    const sill_d = new THREE.Mesh(sill_d_geom, zAlignedElementMats);
    sill_d.position.y = sillY;
    const plate_d_geom = new THREE.BoxGeometry(TOP_PLATE_W, TOP_PLATE_H, D + 2*roofOverhang);
    const plate_d = new THREE.Mesh(plate_d_geom, zAlignedElementMats);
    plate_d.name = 'side_top_plate';
    plate_d.position.y = topPlateY;
    sideWallGroup.add(sill_d, plate_d);

    const studGeomSide = new THREE.BoxGeometry(STUD_D, wallHeight, STUD_THICKNESS);
    sideLayout.positions.forEach(pos => {
        const z = -D/2 + pos;
        const stud = new THREE.Mesh(studGeomSide, verticalElementMats);
        stud.position.set(0, studY, z);
        sideWallGroup.add(stud);
    });
    
    const leftWall = sideWallGroup.clone();
    leftWall.position.x = -W/2 + STUD_D/2;
    group.add(leftWall);
    const rightWall = sideWallGroup.clone();
    rightWall.position.x = W/2 - STUD_D/2;
    group.add(rightWall);

    // Gable Walls (Front and Back - fit between side walls)
    const gableWallGroup = new THREE.Group();
    const sill_w_geom = new THREE.BoxGeometry(gableWallLength, SILL_H, SILL_W);
    const sill_w = new THREE.Mesh(sill_w_geom, xAlignedElementMats);
    sill_w.position.y = sillY;
    const plate_w_geom = new THREE.BoxGeometry(gableWallLength, TOP_PLATE_H, TOP_PLATE_W);
    const plate_w = new THREE.Mesh(plate_w_geom, xAlignedElementMats);
    plate_w.position.y = topPlateY;
    gableWallGroup.add(sill_w, plate_w);
    
    const studGeomGable = new THREE.BoxGeometry(STUD_THICKNESS, wallHeight, STUD_D);
    gableLayout.positions.forEach(pos => {
        const x = -gableWallLength/2 + pos;
        const stud = new THREE.Mesh(studGeomGable, verticalElementMats);
        stud.position.set(x, studY, 0);
        gableWallGroup.add(stud);
    });

    const frontWall = gableWallGroup.clone();
    frontWall.position.z = D/2 - STUD_D/2;
    group.add(frontWall);
    const backWall = gableWallGroup.clone();
    backWall.position.z = -D/2 + STUD_D/2;
    group.add(backWall);

    // --- Bracing (Streben) ---
    const braceY = SILL_H + wallHeight / 2;
    const braceMats = [endGrainMaterial, endGrainMaterial, woodMaterial, woodMaterial, woodMaterial, woodMaterial];

    // This function creates the geometry of a cut brace, lying flat along the X-axis.
    // It will be rotated into its final position.
    const createBraceMesh3D = (braceParam, isLeftToRight) => {
        if (!braceParam || braceParam.length <= 0.01) return null;
        
        const H_formel = wallHeight;
        const D_coord = STUD_THICKNESS; // width of brace in drawing/shape
        const braceExtrusion = STUD_D; // depth of brace
        
        const cutAngleFromVertical_rad = (Math.PI / 2.0) - braceParam.angle;
        if (Math.abs(Math.cos(cutAngleFromVertical_rad)) < 1e-9) return null;
        
        const cos_angle_vert = Math.cos(cutAngleFromVertical_rad);
        const tan_angle_vert = Math.tan(cutAngleFromVertical_rad);
    
        // Factor determines if the parallelogram shape leans left or right, to match rotation direction.
        // isLeftToRight (bottom-left to top-right) needs a shape leaning left (negative X coords) for a positive rotation.
        const factor = isLeftToRight ? -1 : 1;
        
        // This calculates the 2D shape of the brace based on user's formula
        const p1 = { x: 0, y: 0 };
        const p2 = { x: factor * (H_formel / cos_angle_vert), y: 0 };
        const p3 = { x: factor * ((H_formel / cos_angle_vert) + (D_coord * tan_angle_vert)), y: D_coord };
        const p4 = { x: factor * (D_coord * tan_angle_vert), y: D_coord };
        
        const shape = new THREE.Shape([p1, p2, p3, p4].map(p => new THREE.Vector2(p.x, p.y)));
        const extrudeSettings = { depth: braceExtrusion, bevelEnabled: false };
        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        geom.translate(0, 0, -braceExtrusion / 2); // Center on depth axis
        
        const center_x = (p1.x + p3.x) / 2;
        const center_y = (p1.y + p3.y) / 2;
        geom.translate(-center_x, -center_y, 0);
        
        return new THREE.Mesh(geom, braceMats);
    };

    // Gable Braces (Front & Back walls, in XY plane, rotate around Z)
    const firstGableBayCenterX = -gableWallLength / 2 + (gableLayout.positions[0] + gableLayout.positions[1]) / 2;
    // Left Brace: bottom-left to top-right (positive angle)
    const braceGableLeft = createBraceMesh3D(braceParams.gable.first, true); 
    if (braceGableLeft) {
        braceGableLeft.position.set(firstGableBayCenterX, braceY, 0);
        braceGableLeft.rotation.z = braceParams.gable.first.angle;
        frontWall.add(braceGableLeft.clone());
        backWall.add(braceGableLeft.clone());
    }

    const lastGableBayCenterX = -gableWallLength / 2 + (gableLayout.positions[gableLayout.positions.length - 2] + gableLayout.positions[gableLayout.positions.length - 1]) / 2;
    // Right Brace: bottom-right to top-left (negative angle)
    const braceGableRight = createBraceMesh3D(braceParams.gable.last, false); 
    if (braceGableRight) {
        braceGableRight.position.set(lastGableBayCenterX, braceY, 0);
        braceGableRight.rotation.z = -braceParams.gable.last.angle;
        frontWall.add(braceGableRight.clone());
        backWall.add(braceGableRight.clone());
    }
    
    // Side Braces (Left & Right walls, in YZ plane, rotate around X, forming converging /\ shape)
    const firstSideBayCenterZ = -D / 2 + (sideLayout.positions[0] + sideLayout.positions[1]) / 2;
    // Back Brace: bottom-back to top-center (like \\). isLeftToRight=false, negative rotation.
    const braceSideBack = createBraceMesh3D(braceParams.side.first, false); 
    if (braceSideBack) {
        // First, orient the brace to be parallel to the Z axis in the YZ plane
        braceSideBack.rotation.y = Math.PI / 2;
        // Then, apply the slope rotation around the wall's normal (X axis)
        braceSideBack.rotation.x = -braceParams.side.first.angle;
        braceSideBack.position.set(0, braceY, firstSideBayCenterZ);
        leftWall.add(braceSideBack.clone());
        rightWall.add(braceSideBack.clone());
    }

    const lastSideBayCenterZ = -D / 2 + (sideLayout.positions[sideLayout.positions.length - 2] + sideLayout.positions[sideLayout.positions.length - 1]) / 2;
    // Front Brace: bottom-front to top-center (like /). isLeftToRight=true, positive rotation.
    const braceSideFront = createBraceMesh3D(braceParams.side.last, true); 
    if (braceSideFront) {
        braceSideFront.rotation.y = Math.PI / 2;
        braceSideFront.rotation.x = braceParams.side.last.angle;
        braceSideFront.position.set(0, braceY, lastSideBayCenterZ);
        leftWall.add(braceSideFront.clone());
        rightWall.add(braceSideFront.clone());
    }

    // --- ROOF STRUCTURE ---
    // Reposition side wall plates to align their outer face with the studs' outer face
    const plate_l = leftWall.getObjectByName('side_top_plate');
    const plate_r = rightWall.getObjectByName('side_top_plate');
    if (plate_l && plate_r) {
        const plateOffset = (TOP_PLATE_W - STUD_D) / 2;
        plate_l.position.x = plateOffset;
        plate_r.position.x = -plateOffset;
    }

    const rafterAndJoistTotalCount = ${rafterAndJoistTotalCount};
    const rafterAndJoistSpacing = (rafterAndJoistTotalCount > 1) ? (D - RAFTER_W) / (rafterAndJoistTotalCount - 1) : 0;
    const zPositions = Array.from({length: rafterAndJoistTotalCount}, (_, i) => -D/2 + RAFTER_W/2 + i*rafterAndJoistSpacing);

    if (useKingPosts) {
      const joistGeom = new THREE.BoxGeometry(W - 2 * TOP_PLATE_W, TOP_PLATE_H, RAFTER_W);
      const joistY = topPlateY;
      zPositions.forEach(z => {
          const joist = new THREE.Mesh(joistGeom, xAlignedElementMats);
          joist.position.set(0, joistY, z);
          group.add(joist);
      });
    }

    if (roofType === 'Satteldach') {
        const plateInnerX = W / 2 - TOP_PLATE_W;
        const y_bottom = (x_abs) => -tanA * (x_abs - plateInnerX) + H;
        const ridgeNotchDepth = RAFTER_H / 3; // Always create notch
        const ridgeSeatY = y_bottom(BEAM_W/2) + ridgeNotchDepth;
        const ridgeBeamCenterY = ridgeSeatY - BEAM_H/2;
        const ridgeBeamBottomY = ridgeBeamCenterY - BEAM_H / 2;
        const ridgeGeom = new THREE.BoxGeometry(BEAM_W, BEAM_H, D + 2*roofOverhang);
        const ridgePurlin = new THREE.Mesh(ridgeGeom, zAlignedElementMats);
        ridgePurlin.position.y = ridgeBeamCenterY;
        group.add(ridgePurlin);

        if (useKingPosts) {
            const kingPostBottomY = H; // Top of joist/plate
            const kingPostTopY = ridgeBeamBottomY;
            const kingPostHeight = kingPostTopY - kingPostBottomY;
            if (kingPostHeight > 0.1) {
                const kingPostGeom = new THREE.BoxGeometry(RAFTER_W, kingPostHeight, BEAM_W);
                zPositions.forEach(z => {
                    const kingPost = new THREE.Mesh(kingPostGeom, verticalElementMats);
                    kingPost.position.set(0, kingPostBottomY + kingPostHeight/2, z);
                    group.add(kingPost);
                });
            }
        }
        
        // Gable end support posts
        const gablePostHeight = ridgeBeamBottomY - H;
        if (gablePostHeight > 0.1) {
            const peakOffset = tanA * (STUD_THICKNESS / 2);
            const shape = new THREE.Shape();
            shape.moveTo(-STUD_THICKNESS/2, -gablePostHeight/2);
            shape.lineTo(STUD_THICKNESS/2, -gablePostHeight/2);
            shape.lineTo(STUD_THICKNESS/2, gablePostHeight/2 - peakOffset);
            shape.lineTo(0, gablePostHeight/2);
            shape.lineTo(-STUD_THICKNESS/2, gablePostHeight/2 - peakOffset);
            shape.closePath();
            
            const extrudeSettings = { depth: STUD_D, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geom.translate(0, 0, -STUD_D/2);
            
            const gablePostY = H + gablePostHeight / 2;
            const gablePostF = new THREE.Mesh(geom, verticalElementMats);
            gablePostF.position.set(0, gablePostY, D/2 - STUD_D/2);
            const gablePostB = new THREE.Mesh(geom.clone(), verticalElementMats);
            gablePostB.position.set(0, gablePostY, -D/2 + STUD_D/2);
            group.add(gablePostF, gablePostB);
        }

        // --- Rafters with Notches ---
        const createRafterShape = (isLeft) => {
            const sign = isLeft ? -1 : 1;
            const rafterSlopeHeight = RAFTER_H / cosA;
            const x_ridge_plumb = 0, x_ridge_seat_outer = sign * (BEAM_W / 2);
            const x_plate_outer = sign * (W/2), x_plate_inner = sign * (W/2 - TOP_PLATE_W);
            const x_tail_end = sign * (W/2 + roofOverhang);
            const y_top = (x_abs) => y_bottom(x_abs) + rafterSlopeHeight;
            const v = {
                p_ridge_top:    { x: x_ridge_plumb, y: y_top(BEAM_W/2) },
                p_tail_top:     { x: x_tail_end, y: y_top(Math.abs(x_tail_end)) },
                p_tail_bottom:  { x: x_tail_end, y: y_bottom(Math.abs(x_tail_end)) },
                p_heel_bottom:  { x: x_plate_outer, y: y_bottom(Math.abs(x_plate_outer)) },
                p_heel_top:     { x: x_plate_outer, y: H }, p_seat_inner: { x: x_plate_inner, y: H },
                p_ridge_notch_outer_bottom: { x: x_ridge_seat_outer, y: y_bottom(BEAM_W/2) },
                p_ridge_notch_outer_top:    { x: x_ridge_seat_outer, y: ridgeSeatY },
                p_ridge_notch_inner:        { x: x_ridge_plumb, y: ridgeSeatY },
            };
            const points = [v.p_ridge_top, v.p_tail_top, v.p_tail_bottom, v.p_heel_bottom, v.p_heel_top, v.p_seat_inner, v.p_ridge_notch_outer_bottom, v.p_ridge_notch_outer_top, v.p_ridge_notch_inner];
            const vectorPoints = points.map(p => new THREE.Vector2(p.x, p.y));
            return new THREE.Shape(vectorPoints);
        };
        const rightRafterShape = createRafterShape(false);
        const leftRafterShape = createRafterShape(true);
        const rafterExtrudeSettings = { depth: RAFTER_W, bevelEnabled: false };
        const rightRafterGeom = new THREE.ExtrudeGeometry(rightRafterShape, rafterExtrudeSettings);
        rightRafterGeom.translate(0, 0, -RAFTER_W / 2);
        const leftRafterGeom = new THREE.ExtrudeGeometry(leftRafterShape, rafterExtrudeSettings);
        leftRafterGeom.translate(0, 0, -RAFTER_W / 2);
        
        const numRaftersWithOverhang = rafterAndJoistTotalCount + Math.ceil(2 * roofOverhang / rafterAndJoistSpacing);
        const overhangSpacing = (D + 2*roofOverhang - RAFTER_W) / (numRaftersWithOverhang - 1);
        for (let i = 0; i < numRaftersWithOverhang; i++) {
            const zPos = -(D/2 + roofOverhang) + RAFTER_W / 2 + i * overhangSpacing;
            const rafterR = new THREE.Mesh(rightRafterGeom.clone(), [woodMaterial, endGrainMaterial]);
            rafterR.position.z = zPos;
            group.add(rafterR);
            const rafterL = new THREE.Mesh(leftRafterGeom.clone(), [woodMaterial, endGrainMaterial]);
            rafterL.position.z = zPos;
            group.add(rafterL);
        }

        // --- Counter Battens (Traglatten) ---
        if (COUNTER_BATTEN_W > 0 && COUNTER_BATTEN_H > 0) {
            const rafterSlopeHeight = RAFTER_H / cosA;
            const y_top = (x_abs) => y_bottom(x_abs) + rafterSlopeHeight;
            
            const p_ridge_top_vec = new THREE.Vector3(0, y_top(BEAM_W / 2), 0);
            const x_tail_end_abs = W/2 + roofOverhang;
            const p_tail_top_r_vec = new THREE.Vector3(x_tail_end_abs, y_top(x_tail_end_abs), 0);
            const p_tail_top_l_vec = new THREE.Vector3(-x_tail_end_abs, y_top(x_tail_end_abs), 0);

            const rafterLength = p_ridge_top_vec.distanceTo(p_tail_top_r_vec);
            const BATTEN_SPACING = 0.35;
            const numRowsPerSlope = Math.ceil(rafterLength / BATTEN_SPACING);

            const slopeVecR = new THREE.Vector3().subVectors(p_tail_top_r_vec, p_ridge_top_vec).normalize();
            const slopeVecL = new THREE.Vector3().subVectors(p_tail_top_l_vec, p_ridge_top_vec).normalize();
            
            const battenLength = D + 2 * roofOverhang;
            const battenGeom = new THREE.BoxGeometry(COUNTER_BATTEN_W, COUNTER_BATTEN_H, battenLength);
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
        const plateInnerX = W / 2 - TOP_PLATE_W;
        const y_bottom = (x_abs) => -tanA * (x_abs - plateInnerX) + H;
        const rafterSlopeHeight = RAFTER_H / cosA;
        const y_top = (x_abs) => y_bottom(x_abs) + rafterSlopeHeight;
        const ridgeHeight = y_top(BEAM_W / 2);
        
        const totalWidth = W + 2 * roofOverhang;
        const totalDepth = D + 2 * roofOverhang;
        const eavesHeight = H;
        const clearanceHeight = H - SILL_H;

        const side_x = W / 2 + roofOverhang + 1.5;
        const front_z = D / 2 + roofOverhang + 1.5;

        const offset_x_pos = new THREE.Vector3(1, 0, 0);
        const offset_y_neg = new THREE.Vector3(0, -1, 0);
        
        // Vertical dimensions
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, 0), new THREE.Vector3(side_x, ridgeHeight, 0), 'First: ' + ridgeHeight.toFixed(2) + 'm', offset_x_pos, 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, 0), new THREE.Vector3(side_x, eavesHeight, 0), 'Traufe: ' + eavesHeight.toFixed(2) + 'm', offset_x_pos, -0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(0, 0, front_z), new THREE.Vector3(0, clearanceHeight, front_z), 'Lichte Höhe: ' + clearanceHeight.toFixed(2) + 'm', offset_x_pos, 0));

        // Horizontal dimensions
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(-totalWidth / 2, -0.5, 0), new THREE.Vector3(totalWidth / 2, -0.5, 0), 'Gesamtbreite: ' + totalWidth.toFixed(2) + 'm', offset_y_neg, 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(0, -0.5, -totalDepth / 2), new THREE.Vector3(0, -0.5, totalDepth / 2), 'Gesamttiefe: ' + totalDepth.toFixed(2) + 'm', new THREE.Vector3(0, -1, 1).normalize(), 0.5));

        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(-W / 2, 0, front_z), new THREE.Vector3(W / 2, 0, front_z), 'Rahmenbreite: ' + W.toFixed(2) + 'm', new THREE.Vector3(0, 0, 1), 0.5));
        dimensionsGroup.add(createDimensionLine(new THREE.Vector3(side_x, 0, -D / 2), new THREE.Vector3(side_x, 0, D / 2), 'Rahmentiefe: ' + D.toFixed(2) + 'm', offset_x_pos, 0));
    }
    // --- END Dimensioning Code ---
    
    return group;
  `;
    
    return {
        mainModelCode,
        partsList: Array.from(parts.values()),
    };
}
