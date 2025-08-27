
import { PartInfo, RoofType } from './types';
import { calculateStudLayout } from './drawingUtils';

export const calculateDeflection = (parts: PartInfo[], params: any): PartInfo[] => {
    const { W, D, roofOverhang, numberOfPostsPerSide, RAFTER_W, RAFTER_H, BEAM_W, BEAM_H, TIE_BEAM_H, roofType, roofPitch, altitude, POST_DIM, middlePurlin, STUD_D } = params;
    const E_MODULUS = 11e9; // N/m^2 (C24 timber)
    const WOOD_DENSITY = 4900; // N/m^3
    const roofAngleRad = (roofPitch * Math.PI) / 180;
    const cosA = Math.cos(roofAngleRad);
    
    // Schnee- und Dachlast (horizontale Projektion)
    const snowLoadGround = (altitude / 500 + 0.4) * 0.8 * 1000; // N/m^2 am Boden
    const numRaftersTotal = Math.max(2, Math.floor(D / 0.8) + 1);
    const rafterSpacing = (numRaftersTotal > 1) ? (D - RAFTER_W) / (numRaftersTotal - 1) : D;
    const totalRoofLoadPerM2 = snowLoadGround + (RAFTER_W * RAFTER_H * WOOD_DENSITY / rafterSpacing);

    // Gartenhaus constants for statics
    const STUD_THICKNESS = 0.055;
    const TOP_PLATE_H = BEAM_H > 0.1 ? BEAM_H : 0.12;
    const TOP_PLATE_W = BEAM_W > 0.08 ? BEAM_W : 0.10;

    const isCarport = !!numberOfPostsPerSide;

    return parts.map(part => {
        let span = 0;
        let tempWidth = 0, tempHeight = 0;
        let isRafter = false, isPurlin = false, isTieBeam = false, isCeilingJoist = false;
        
        const newPart = { ...part };

        // Special statics for Gartenhaus Fusspfette and Firstpfette
        if (!isCarport && (part.key === 'top_plate_d' || part.key === 'ridge_beam')) {
            let tempWidth, tempHeight, tributaryWidth, maxInnerSpan, cantileverSpan;

            if (part.key === 'top_plate_d') { // Fusspfette
                tempWidth = TOP_PLATE_W;
                tempHeight = TOP_PLATE_H;
                const sideLayout = calculateStudLayout(D, STUD_THICKNESS, 0.625);
                maxInnerSpan = Math.max(...sideLayout.spacings);
                
                const rafterSpanHorizontal = W / 2;
                tributaryWidth = middlePurlin ? rafterSpanHorizontal / 4 : rafterSpanHorizontal / 2;
            } else { // ridge_beam (Firstpfette) for Gartenhaus
                tempWidth = BEAM_W;
                tempHeight = BEAM_H;
                // The ridge beam in a garden house is supported by the gable walls at the front and back.
                // The main span is therefore the depth of the building.
                maxInnerSpan = D;

                const rafterSpanHorizontal = W / 2;
                tributaryWidth = middlePurlin ? rafterSpanHorizontal / 2 : rafterSpanHorizontal;
            }
            
            cantileverSpan = roofOverhang;
            if (cantileverSpan < 0.1) cantileverSpan = 0;

            const inertia = (tempWidth * Math.pow(tempHeight, 3)) / 12;
            const selfWeight_per_m = tempWidth * tempHeight * WOOD_DENSITY;
            const load_per_m = totalRoofLoadPerM2 * tributaryWidth + selfWeight_per_m;

            // Check inner span
            const allowedDeflectionInner = maxInnerSpan / 300;
            const deflection_inner = (5 * load_per_m * Math.pow(maxInnerSpan, 4)) / (384 * E_MODULUS * inertia);
            const passed_inner = deflection_inner <= allowedDeflectionInner;

            // Check cantilever span
            let deflection_cantilever = 0, passed_cantilever = true, allowedDeflectionCantilever = Infinity;
            if (cantileverSpan > 0) {
                allowedDeflectionCantilever = cantileverSpan / 150;
                deflection_cantilever = (load_per_m * Math.pow(cantileverSpan, 4)) / (8 * E_MODULUS * inertia);
                passed_cantilever = deflection_cantilever <= allowedDeflectionCantilever;
            }

            const finalPassed = passed_inner && passed_cantilever;
            const isCantileverCritical = cantileverSpan > 0 && (deflection_cantilever / allowedDeflectionCantilever) > (deflection_inner / allowedDeflectionInner);
            
            let formula, formulaDescription, maxDeflection, allowedDeflection, finalSpan;
            
            if (isCantileverCritical) {
                finalSpan = cantileverSpan;
                maxDeflection = deflection_cantilever;
                allowedDeflection = allowedDeflectionCantilever;
                formula = 'w = (q · L⁴) / (8 · E · I)';
                formulaDescription = `Kritischer Punkt: Auskragung (${(cantileverSpan*100).toFixed(0)}cm).\nDurchbiegung (w) für Kragarm unter Gleichlast (q).`;
            } else {
                finalSpan = maxInnerSpan;
                maxDeflection = deflection_inner;
                allowedDeflection = allowedDeflectionInner;
                formula = 'w = (5 · q · L⁴) / (384 · E · I)';
                formulaDescription = `Kritischer Punkt: Innenfeld (${(maxInnerSpan*100).toFixed(0)}cm).\nDurchbiegung (w) eines Balkens unter Gleichlast (q).`;
            }

            newPart.statics = {
                span: finalSpan, load: load_per_m, maxDeflection, allowedDeflection,
                passed: finalPassed, inertia, eModulus: E_MODULUS,
                formula, formulaDescription
            };
            return newPart;
        }


        if (part.key.includes('rafter')) {
            isRafter = true;
            tempWidth = RAFTER_W;
            tempHeight = RAFTER_H;
            if (roofType === 'Satteldach') {
                const rafterSpanHorizontal = W / 2 - BEAM_W/2;
                span = middlePurlin ? rafterSpanHorizontal / 2 / cosA : rafterSpanHorizontal / cosA;
            } else {
                span = middlePurlin ? W / 2 / cosA : W / cosA;
            }
        } else if (part.key === 'ceiling_joist') {
            isCeilingJoist = true;
            tempWidth = RAFTER_W;
            tempHeight = TOP_PLATE_H;
            span = W - 2 * TOP_PLATE_W;
        } else if (part.key.includes('tie_beam') || part.key.includes('cross_member')) {
            isTieBeam = true;
            tempWidth = BEAM_W;
            if (part.key.includes('cross_member') && TIE_BEAM_H) { // Pultdach Carport Zange
                tempHeight = TIE_BEAM_H;
            } else { // Satteldach Carport Zange
                tempHeight = BEAM_H;
            }
            span = W - POST_DIM;
        } else if (part.key.includes('plate') || part.key.includes('purlin') || part.key.includes('beam')) {
            isPurlin = true;
            if (part.key.includes('middle') && middlePurlin) {
               tempWidth = middlePurlin.w;
               tempHeight = middlePurlin.h;
            } else {
               tempWidth = BEAM_W;
               tempHeight = BEAM_H;
            }
            const postDistributionLength = D - (2 * roofOverhang);
            span = (numberOfPostsPerSide > 1) ? postDistributionLength / (numberOfPostsPerSide - 1) : postDistributionLength;
        }

        if (span > 0.1 && (isRafter || isPurlin || isTieBeam || isCeilingJoist)) {
            const inertia = (tempWidth * Math.pow(tempHeight, 3)) / 12;
            const allowedDeflection = span / 300;
            const selfWeight_per_m = tempWidth * tempHeight * WOOD_DENSITY;

            let totalLoad_per_m = selfWeight_per_m;
            let maxDeflection = 0;
            
            if (isRafter) {
                const loadOnRafterPerMeterOfSlope = totalRoofLoadPerM2 * rafterSpacing * cosA;
                totalLoad_per_m += loadOnRafterPerMeterOfSlope;
                const loadPerpendicular = totalLoad_per_m * cosA;
                maxDeflection = (5 * loadPerpendicular * Math.pow(span, 4)) / (384 * E_MODULUS * inertia);
                
                 newPart.statics = {
                    span, load: loadPerpendicular, maxDeflection, allowedDeflection,
                    passed: maxDeflection <= allowedDeflection, inertia, eModulus: E_MODULUS,
                    formula: 'w = (5 · q⟂ · L⁴) / (384 · E · I)',
                    formulaDescription: 'Berechnung der Durchbiegung (w) für Gleichlast (q) senkrecht zum Bauteil.',
                };

            } else if (isPurlin) {
                 let tributaryWidth = 0;
                 if (roofType === 'Satteldach') {
                    const rafterSpanHorizontal = W / 2 - BEAM_W / 2; // Span von Traufe bis First (horizontal)
                    if (part.key.includes('side_plate')) {
                        // Traufpfette trägt Hälfte des inneren Feldes PLUS den kompletten Überhang
                        tributaryWidth = (middlePurlin ? rafterSpanHorizontal / 4 : rafterSpanHorizontal / 2) + roofOverhang;
                    } else if (part.key.includes('middle_purlin')) {
                        // Mittelpfette trägt je eine Hälfte der angrenzenden Felder
                        tributaryWidth = rafterSpanHorizontal / 2;
                    } else if (part.key.includes('ridge_beam')) {
                        // Firstpfette trägt die andere Hälfte des inneren Feldes
                        tributaryWidth = middlePurlin ? rafterSpanHorizontal / 4 : rafterSpanHorizontal / 2;
                    }
                } else { // Pultdach
                    const rafterSpanHorizontal = W - BEAM_W;
                    if (part.key.includes('purlin_high') || part.key.includes('purlin_low')) {
                        tributaryWidth = (middlePurlin ? rafterSpanHorizontal / 4 : rafterSpanHorizontal / 2) + roofOverhang;
                    }
                    else if (part.key.includes('middle_purlin_pult')) {
                        tributaryWidth = rafterSpanHorizontal / 2;
                    }
                }
                
                if (tributaryWidth > 0) {
                     // Last wird als Einzugsbreite auf die Pfette umgerechnet
                    totalLoad_per_m += totalRoofLoadPerM2 * tributaryWidth;
                }

                maxDeflection = (5 * totalLoad_per_m * Math.pow(span, 4)) / (384 * E_MODULUS * inertia);
                
                newPart.statics = {
                    span, load: totalLoad_per_m, maxDeflection, allowedDeflection,
                    passed: maxDeflection <= allowedDeflection, inertia, eModulus: E_MODULUS,
                    formula: 'w = (5 · q · L⁴) / (384 · E · I)',
                    formulaDescription: 'Berechnung der Durchbiegung (w) eines Balkens unter Gleichlast (q).',
                };
            } else if (isTieBeam) {
                const deflection_udl = (5 * selfWeight_per_m * Math.pow(span, 4)) / (384 * E_MODULUS * inertia);
                let deflection_point = 0;
                let pointLoad = 0;
                
                const postDistributionLength = D - (2 * roofOverhang);
                const postSpacing = (numberOfPostsPerSide > 1) ? postDistributionLength / (numberOfPostsPerSide - 1) : postDistributionLength;

                if (roofType === 'Satteldach') {
                    // Die Zange wird durch die First-Stütze belastet
                    const ridgeTributarySpan = W / 2 - BEAM_W / 2; // Horizontal
                    const ridgeTributaryArea = (middlePurlin ? ridgeTributarySpan / 2 : ridgeTributarySpan) * postSpacing;
                    const ridgeLoad_per_m_self = (BEAM_W * BEAM_H * WOOD_DENSITY);
                    pointLoad = totalRoofLoadPerM2 * ridgeTributaryArea + (ridgeLoad_per_m_self * postSpacing);

                } else if (roofType === 'Pultdach' && middlePurlin && middlePurlin.w > 0) {
                     // Die Zange wird durch die Mittelpfetten-Stütze belastet
                    const middlePurlinTributarySpan = W / 2;
                    const middlePurlinTributaryArea = middlePurlinTributarySpan * postSpacing;
                    const middlePurlinLoad_per_m_self = (middlePurlin.w * middlePurlin.h * WOOD_DENSITY);
                    pointLoad = totalRoofLoadPerM2 * middlePurlinTributaryArea + (middlePurlinLoad_per_m_self * postSpacing);
                }

                if (pointLoad > 0) {
                    deflection_point = (pointLoad * Math.pow(span, 3)) / (48 * E_MODULUS * inertia);
                }

                maxDeflection = deflection_udl + deflection_point;
                
                newPart.statics = {
                    span, load: selfWeight_per_m, pointLoad: pointLoad > 0 ? pointLoad : undefined,
                    maxDeflection, allowedDeflection, passed: maxDeflection <= allowedDeflection,
                    inertia, eModulus: E_MODULUS,
                    formula: `w_ges = w(q) ${pointLoad > 0 ? '+ w(P)' : ''}`,
                    formulaDescription: `Gesamtdurchbiegung aus Eigengewicht (q)${pointLoad > 0 ? ' und Punktlast (P) von Stütze.' : '.'}\nw(q) = (5·q·L⁴)/(384·E·I)${pointLoad > 0 ? '\nw(P) = (P·L³)/(48·E·I)' : ''}`,
                };
            } else if (isCeilingJoist) {
                const deflection_udl = (5 * selfWeight_per_m * Math.pow(span, 4)) / (384 * E_MODULUS * inertia);
                let deflection_point = 0;
                let pointLoad = 0;
                
                const rafterAndJoistTotalCount = Math.max(2, Math.floor(D / 0.8) + 1);
                const rafterAndJoistSpacing = (rafterAndJoistTotalCount > 1) ? (D - RAFTER_W) / (rafterAndJoistTotalCount - 1) : D;

                if (roofType === 'Satteldach') {
                    // Load from king post supporting the ridge purlin
                    const ridgeTributarySpan = W / 2 - TOP_PLATE_W; // Horizontal rafter span
                    const ridgeTributaryArea = (middlePurlin ? ridgeTributarySpan / 2 : ridgeTributarySpan) * rafterAndJoistSpacing;
                    const ridgeLoad_per_m_self = (BEAM_W * BEAM_H * WOOD_DENSITY);
                    pointLoad = totalRoofLoadPerM2 * ridgeTributaryArea + (ridgeLoad_per_m_self * rafterAndJoistSpacing);
                }

                if (pointLoad > 0) {
                    deflection_point = (pointLoad * Math.pow(span, 3)) / (48 * E_MODULUS * inertia);
                }

                maxDeflection = deflection_udl + deflection_point;
                
                newPart.statics = {
                    span, load: selfWeight_per_m, pointLoad: pointLoad > 0 ? pointLoad : undefined,
                    maxDeflection, allowedDeflection, passed: maxDeflection <= allowedDeflection,
                    inertia, eModulus: E_MODULUS,
                    formula: `w_ges = w(q) ${pointLoad > 0 ? '+ w(P)' : ''}`,
                    formulaDescription: `Gesamtdurchbiegung aus Eigengewicht (q)${pointLoad > 0 ? ' und Punktlast (P) von First-Stütze.' : '.'}\nw(q) = (5·q·L⁴)/(384·E·I)${pointLoad > 0 ? '\nw(P) = (P·L³)/(48·E·I)' : ''}`,
                };
            }

            return newPart;
        }
        return part;
    });
};
