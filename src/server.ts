
import express from 'express';
import { GoogleGenAI, Type } from "@google/genai";
import path from 'path';

// Import the construction logic, adding '.js' for ES module compatibility after compilation.
import { BuildingType } from './public/types.js';
import { generateCarportPlan } from './public/carport_construction.js';
import { generateGartenhausPlan } from './public/gartenhaus_construction.js';
import { calculateDeflection } from './public/statics.js';
import { SummaryInfo, PartInfo } from './public/types.js';

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Serve static files from the compiled public directory
const publicPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
app.use(express.static(publicPath));


// API endpoint to handle the entire construction plan generation
app.post('/api/generate', async (req, res) => {
    try {
        const { buildingType, dimensions, roofType, roofOverhang, roofPitch } = req.body;
        
        // Body validation
        if (!buildingType || !dimensions || !roofType || roofOverhang === undefined || roofPitch === undefined) {
            return res.status(400).json({ error: "Missing required parameters." });
        }
        
        // The entire generation logic is moved from the frontend to here
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const isGartenhausLike = buildingType === 'Gartenhaus' || buildingType === 'Sauna' || buildingType === 'Schopf';

        // --- 1. Bestimme strukturelle Konfiguration via KI ---
        const numWidth = parseFloat(dimensions.width) || 0;
        const numDepth = parseFloat(dimensions.depth) || 0;
        const numOverhang = parseFloat(roofOverhang) || 0;
        const transversalSpan = numWidth;
        const longitudinalSpan = numDepth;

        let textPrompt;
        let schema;

        if (isGartenhausLike) {
            textPrompt = `Sie sind ein erfahrener Schweizer Holzbauingenieur. Ihre Aufgabe ist es, die notwendige **strukturelle Konfiguration** für ein Holzbauprojekt zu definieren. Anhand Ihrer Konfiguration werden die exakten Balkenquerschnitte anschliessend programmgesteuert optimiert.
PROJEKTDATEN:
- Gebäudetyp: ${buildingType}
- Statisch relevante Spannweiten:
  - Querspannweite (Breite): ${transversalSpan.toFixed(2)}m
- Höhe bis Oberkante Wand: ${dimensions.height}m
- Dach: ${roofType} mit ${roofPitch} Grad Neigung
- Standort: ${dimensions.altitude} m.ü.M.
- Wandaufbau: Ständerwände mit 55mm Tiefe und ca. 62.5cm Achsmass.

ANFORDERUNGEN:
1.  **Ständerbreite (\`studDepth\`):** Wählen Sie eine passende Breite für die Wandständer (Tiefe ist fix 55mm) aus der folgenden Liste von Standardquerschnitten in Metern: [0.08, 0.10, 0.12, 0.14, 0.16]. Berücksichtigen Sie dabei die üblichen Anforderungen an Statik und Dämmung.
2.  **Mittelpfette (\`useMiddlePurlin\`):** Entscheiden Sie, ob eine Mittelpfette im Dach aus statischen Gründen (z.B. bei grossen Sparrenspannweiten von über 5-6 Metern) notwendig ist.
3.  **Firststützen & Zangen (\`useKingPosts\`):** Entscheiden Sie, ob aufgrund der Gebäudebreite von ${transversalSpan.toFixed(2)}m Stützen unter der Firstpfette und zugehörige Zangen (Deckenträger) statisch notwendig sind. Bei kleinen Breiten (bis ca. 4-5m) kann oft darauf verzichtet werden, um einen offenen Dachraum zu erhalten.
4.  **Traglatten (\`counterBattenW\`, \`counterBattenH\`):** Wählen Sie eine passende Dimension für die Traglatten (früher Konterlatten) aus der folgenden Liste von Standardquerschnitten in Metern: [{w:0.045, h:0.050}, {w:0.050, h:0.060}, {w:0.060, h:0.060}, {w:0.060, h:0.080}, {w:0.060, h:0.100}]. Berücksichtigen Sie dabei die üblichen Anforderungen für Dacheindeckungen und Belüftung.
5.  **JSON-Struktur:** Liefern Sie das Ergebnis EXAKT im geforderten JSON-Format ohne weiteren Text oder Kommentare.`;
            
            schema = {
              type: Type.OBJECT,
              properties: {
                structuralConfig: {
                  type: Type.OBJECT,
                  description: "Von der KI bestimmte strukturelle Konfiguration.",
                  properties: {
                    studDepth: { type: Type.NUMBER, description: "Breite des Wandständers in Metern (Tiefe ist 55mm)." },
                    useMiddlePurlin: { type: Type.BOOLEAN, description: "Gibt an, ob eine Mittelpfette statisch notwendig ist (true/false)." },
                    useKingPosts: { type: Type.BOOLEAN, description: "Gibt an, ob Firststützen und Zangen (Deckenträger) notwendig sind." },
                    counterBattenW: { type: Type.NUMBER, description: "Breite der Traglatte in Metern." },
                    counterBattenH: { type: Type.NUMBER, description: "Höhe der Traglatte in Metern." }
                  },
                  required: ["studDepth", "useMiddlePurlin", "useKingPosts", "counterBattenW", "counterBattenH"]
                }
              },
              required: ["structuralConfig"]
            };

        } else { // Carport
            textPrompt = `Sie sind ein erfahrener Schweizer Holzbauingenieur. Ihre Aufgabe ist es, die notwendige **strukturelle Konfiguration** für ein Holzbauprojekt zu definieren. Anhand Ihrer Konfiguration werden die exakten Balkenquerschnitte anschliessend programmgesteuert optimiert.
PROJEKTDATEN:
- Gebäudetyp: ${buildingType}
- Statisch relevante Spannweiten:
  - Querspannweite (Breite): ${transversalSpan.toFixed(2)}m
  - Längsspannweite (Tiefe, zwischen den Pfosten): ${(longitudinalSpan - 2 * numOverhang).toFixed(2)}m
- Höhe: ${dimensions.height}m
- Dach: ${roofType} mit ${roofPitch} Grad Neigung
- Standort: ${dimensions.altitude} m.ü.M.

HINWEIS: Bei einem Pultdach ohne Mittelpfette haben die Zangen (Querverbinder zwischen den Längsseiten) primär eine aussteifende, aber fast keine tragende Funktion. Ihre Dimensionierung wird separat optimiert und muss hier nicht berücksichtigt werden.

ANFORDERUNGEN:
1.  **Pfostenanzahl pro Seite (\`numberOfPostsPerSide\`):** Bestimmen Sie die statisch notwendige Anzahl Pfosten pro Längsseite (Mindestwert 2), um eine wirtschaftliche Dimensionierung der Längspfetten zu ermöglichen. Bei einer Länge von über 6-7m sind in der Regel mehr als 2 Pfosten sinnvoll.
2.  **Mittelpfette (\`useMiddlePurlin\`):** Entscheiden Sie, ob eine Mittelpfette aus statischen Gründen (z.B. bei grossen Sparrenspannweiten von über 5-6 Metern) notwendig ist.
3.  **Traglatten (\`counterBattenW\`, \`counterBattenH\`):** Wählen Sie eine passende Dimension für die Traglatten (früher Konterlatten) aus der folgenden Liste von Standardquerschnitten in Metern: [{w:0.045, h:0.050}, {w:0.050, h:0.060}, {w:0.060, h:0.060}, {w:0.060, h:0.080}, {w:0.060, h:0.100}]. Berücksichtigen Sie dabei die üblichen Anforderungen für Dacheindeckungen und Belüftung.
4.  **JSON-Struktur:** Liefern Sie das Ergebnis EXAKT im geforderten JSON-Format ohne weiteren Text oder Kommentare.`;
        
            schema = {
              type: Type.OBJECT,
              properties: {
                structuralConfig: {
                  type: Type.OBJECT,
                  description: "Von der KI bestimmte strukturelle Konfiguration.",
                  properties: {
                    numberOfPostsPerSide: { type: Type.NUMBER, description: "Anzahl der Pfosten pro Längsseite (z.B. 2, 3 oder 4)." },
                    useMiddlePurlin: { type: Type.BOOLEAN, description: "Gibt an, ob eine Mittelpfette statisch notwendig ist (true/false)." },
                    counterBattenW: { type: Type.NUMBER, description: "Breite der Traglatte in Metern." },
                    counterBattenH: { type: Type.NUMBER, description: "Höhe der Traglatte in Metern." }
                  },
                  required: ["numberOfPostsPerSide", "useMiddlePurlin", "counterBattenW", "counterBattenH"]
                }
              },
              required: ["structuralConfig"]
            };
        }

        const configResult = await ai.models.generateContent({
            model: 'gemini-2.5-flash', contents: textPrompt,
            config: { responseMimeType: 'application/json', responseSchema: schema }
        });

        let jsonString = configResult.text.trim();
        if (!jsonString) throw new Error("Die KI hat eine leere Konfiguration zurückgegeben.");
        const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) jsonString = jsonMatch[1];
        
        const parsedConfig = JSON.parse(jsonString);
        const structuralConfig = parsedConfig.structuralConfig;
        if (!structuralConfig) {
          throw new Error("Die KI hat keine gültige Konfiguration zurückgegeben.");
        }

        // --- 2. Programmatische Dimensionierung und Statik-Optimierung ---
        const standardWidths = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24];
        const standardHeights = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34, 0.36, 0.38, 0.40, 0.44, 0.48, 0.50];
        const getNextStandard = (currentValue: number, standards: number[]) => {
            return standards.find(s => s > currentValue + 0.001) || currentValue + 0.02; // Fallback
        };

        let optimizedDims = {
            postDim: 0.12, beamW: 0.12, beamH: 0.12, tieBeamH: 0.14, rafterW: 0.08,
            rafterH: 0.16, braceDim: 0.10, counterBattenW: 0.06, counterBattenH: 0.08,
            middlePurlinW: 0.12, middlePurlinH: 0.16, studD: 0.12, useKingPosts: true,
            ...structuralConfig
        };

        let staticsPassed = false;
        let iterations = 0;
        const MAX_ITERATIONS = 30;

        while(!staticsPassed && iterations < MAX_ITERATIONS) {
            iterations++;
            const tempParams = {
                W: parseFloat(dimensions.width) || 5, D: parseFloat(dimensions.depth) || 6, H: parseFloat(dimensions.height) || 3,
                roofType: roofType as RoofType, roofOverhang: parseFloat(roofOverhang) || 0.5, roofPitch: parseFloat(roofPitch) || 15,
                POST_DIM: optimizedDims.postDim, BEAM_W: optimizedDims.beamW, BEAM_H: optimizedDims.beamH,
                TIE_BEAM_H: optimizedDims.tieBeamH, RAFTER_W: optimizedDims.rafterW, RAFTER_H: optimizedDims.rafterH,
                BRACE_DIM: optimizedDims.braceDim, COUNTER_BATTEN_W: optimizedDims.counterBattenW, COUNTER_BATTEN_H: optimizedDims.counterBattenH,
                numberOfPostsPerSide: optimizedDims.numberOfPostsPerSide,
                middlePurlin: optimizedDims.useMiddlePurlin ? { w: optimizedDims.middlePurlinW, h: optimizedDims.middlePurlinH } : null,
                altitude: parseFloat(dimensions.altitude) || 600,
                STUD_D: optimizedDims.studD, useKingPosts: optimizedDims.useKingPosts,
            };
            
            const { partsList: tempList } = isGartenhausLike 
              ? generateGartenhausPlan(tempParams)
              : generateCarportPlan(tempParams);
            
            const checkedList = calculateDeflection(tempList, tempParams);
            const failedParts = checkedList.filter(p => p.statics && !p.statics.passed);
            
            if (failedParts.length === 0) {
                staticsPassed = true;
            } else {
                if (failedParts.some(p => p.key.includes('rafter'))) optimizedDims.rafterH = getNextStandard(optimizedDims.rafterH, standardHeights);
                if (failedParts.some(p => p.key.includes('plate') || p.key.includes('purlin') || p.key.includes('beam') || p.key.includes('tie_beam') || p.key.includes('top_plate') || p.key.includes('ceiling_joist'))) optimizedDims.beamH = getNextStandard(optimizedDims.beamH, standardHeights);
                if (failedParts.some(p => p.key.includes('cross_member'))) optimizedDims.tieBeamH = getNextStandard(optimizedDims.tieBeamH, standardHeights);
                if (failedParts.some(p => p.key.includes('middle_purlin'))) optimizedDims.middlePurlinH = getNextStandard(optimizedDims.middlePurlinH, standardHeights);
                if (optimizedDims.beamH > optimizedDims.beamW * 2.5 && optimizedDims.beamW < 0.24) optimizedDims.beamW = getNextStandard(optimizedDims.beamW, standardWidths);
            }
        }

        if (!staticsPassed) throw new Error("Statik-Optimierung konnte nach mehreren Versuchen keine stabile Dimension finden. Bitte überprüfen Sie die Eingabewerte.");
        optimizedDims.postDim = optimizedDims.beamW;

        // --- 3. Generate 3D Background ---
        const genericBackgroundPrompt = `Sie sind ein 3D-Umgebungsdesigner, der JavaScript-Code für Three.js schreibt.
AUFGABE: Erstellen Sie eine ansprechende, generische Landschaftsszene. Sie haben Zugriff auf eine vordefinierte Variable namens \`group\` (eine THREE.Group). Alle von Ihnen erstellten Objekte müssen zu dieser Gruppe hinzugefügt werden.
ANFORDERUNGEN:
1.  **Boden:** Erstellen Sie eine große, grüne \`THREE.PlaneGeometry\` (ca. 100x100), die Schatten empfängt (\`receiveShadow = true\`). Fügen Sie das resultierende Mesh zur \`group\` hinzu.
2.  **Dekoration:** Erstellen Sie 5-10 einfache Bäume. Ein Baum besteht aus einem braunen Zylinder (Stamm) und einem grünen Kegel (Krone). Platzieren Sie die Bäume zufällig, aber VERMEIDEN Sie den zentralen Bereich (x von -10 bis 10 und z von -10 bis 10). Fügen Sie jeden Baum zur \`group\` hinzu.
3.  **Materialien:** Verwenden Sie nur \`THREE.MeshStandardMaterial\` mit einfachen Farben (z.B. 'green' für den Boden, 'darkgreen' für Baumkronen, 'saddlebrown' für Stämme). Verwenden Sie keine Texturen.
4.  **Variablen:** Sie haben Zugriff auf die Variablen \`THREE\` und \`group\`.
ABSOLUTE ANFORDERUNG AN DEN OUTPUT: Liefern Sie NUR den JavaScript-Code-Body. KEINE Funktionsdeklarationen, KEINE \`return\`-Anweisungen, KEINE Markdown-Formatierung wie \`\`\`javascript.`;
      
        const backgroundResult = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: genericBackgroundPrompt });
        const generatedBackgroundCode = backgroundResult.text;

        // --- 4. Generiere 3D-Modell und Stückliste mit finalen Dimensionen ---
        const finalModelParams = {
          W: parseFloat(dimensions.width) || 5, D: parseFloat(dimensions.depth) || 6, H: parseFloat(dimensions.height) || 3,
          roofType: roofType as RoofType, roofOverhang: parseFloat(roofOverhang) || 0.5, roofPitch: parseFloat(roofPitch) || 15,
          POST_DIM: optimizedDims.postDim, BEAM_W: optimizedDims.beamW, BEAM_H: optimizedDims.beamH,
          TIE_BEAM_H: optimizedDims.tieBeamH, RAFTER_W: optimizedDims.rafterW, RAFTER_H: optimizedDims.rafterH,
          BRACE_DIM: optimizedDims.braceDim, COUNTER_BATTEN_W: optimizedDims.counterBattenW, COUNTER_BATTEN_H: optimizedDims.counterBattenH,
          numberOfPostsPerSide: optimizedDims.numberOfPostsPerSide,
          middlePurlin: optimizedDims.useMiddlePurlin ? { w: optimizedDims.middlePurlinW, h: optimizedDims.middlePurlinH } : null,
          altitude: parseFloat(dimensions.altitude) || 600,
          STUD_D: optimizedDims.studD, useKingPosts: optimizedDims.useKingPosts,
        };
        
        const { mainModelCode, partsList: initialPartsList } = isGartenhausLike
          ? generateGartenhausPlan(finalModelParams)
          : generateCarportPlan(finalModelParams);

        const finalPartsList: PartInfo[] = calculateDeflection(initialPartsList, finalModelParams);

        // --- 5. Berechne Gesamtgewichte und Lasten für die Zusammenfassung ---
        const WOOD_DENSITY_KG_M3 = 500; const G = 9.81;
        let totalVolume = 0;
        finalPartsList.forEach(part => {
            if (part.cuttingPlan) {
                const numStock = part.cuttingPlan.bins.reduce((sum, bin) => sum + bin.count, 0);
                const battenDimMatch = part.description.match(/(\d+)x(\d+)mm/);
                if (battenDimMatch) {
                    const w = parseInt(battenDimMatch[1], 10) / 1000;
                    const h = parseInt(battenDimMatch[2], 10) / 1000;
                    totalVolume += w * h * part.cuttingPlan.stockLength * numStock;
                }
            } else {
                const desc = part.description.replace(/\s+/g, ' ');
                const dimMatch = desc.match(/(\d+\.\d+)x(\d+\.\d+)cm, Länge: (\d+\.\d+)cm/);
                if (dimMatch) {
                    const w = parseFloat(dimMatch[1]) / 100;
                    const h = parseFloat(dimMatch[2]) / 100;
                    const l = parseFloat(dimMatch[3]) / 100;
                    totalVolume += w * h * l * part.quantity;
                }
            }
        });
        const totalTimberWeight = totalVolume * WOOD_DENSITY_KG_M3 * G;
        const numAltitude = parseFloat(dimensions.altitude) || 600;
        const snowLoadGround = (numAltitude / 500 + 0.4) * 0.8 * 1000;
        const projectedRoofArea = (parseFloat(dimensions.width) || 0) * (parseFloat(dimensions.depth) || 0);
        const totalSnowLoadOnRoof = snowLoadGround * projectedRoofArea;

        const summary: SummaryInfo = {
            timberWeight: totalTimberWeight, timberVolume: totalVolume,
            snowLoad: totalSnowLoadOnRoof, totalLoad: totalTimberWeight + totalSnowLoadOnRoof
        };
        
        // Send the complete result back to the client
        res.json({
            generatedModelCode: mainModelCode,
            generatedBackgroundCode: generatedBackgroundCode,
            partsList: finalPartsList,
            summary: summary,
        });

    } catch (e) {
        console.error("Error in /api/generate:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: `Ein serverseitiger Fehler ist aufgetreten: ${errorMessage}` });
    }
});

// Fallback route to serve the main HTML file for client-side routing.
app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
