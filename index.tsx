
import { render, JSX } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/compat';
import { GoogleGenAI, Type } from "@google/genai";

// Import newly created modules
import { BuildingType, RoofType, PartInfo, SummaryInfo, BUILDING_TYPES } from './types';
import { generateCarportPlan } from './carport_construction';
import { generateGartenhausPlan } from './gartenhaus_construction';
import { calculateDeflection } from './statics';
import { generatePdf } from './pdfGenerator';
import { Viewer } from './Viewer';
import { PartDrawing, CuttingPlanVisualizer } from './PartDrawing';
import { StaticsDisplay } from './StaticsDisplay';
import { SummaryDisplay } from './SummaryDisplay';

// --- Debounce Hook for smoother inputs ---
const useDebounce = (value: any, delay: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
};


const App = () => {
  // --- Zustandsvariablen (State) ---
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [buildingType, setBuildingType] = useState<BuildingType | null>(null);
  const [dimensions, setDimensions] = useState({ width: '7.5', depth: '7.5', height: '3', altitude: '750' });
  const [roofType, setRoofType] = useState<RoofType>('Satteldach');
  const [roofOverhang, setRoofOverhang] = useState('0.8');
  const [roofPitch, setRoofPitch] = useState('30');
  
  // Debounced values for performance
  const debouncedDimensions = useDebounce(dimensions, 400);
  const debouncedRoofOverhang = useDebounce(roofOverhang, 400);
  const debouncedRoofPitch = useDebounce(roofPitch, 400);

  const [generatedModelCode, setGeneratedModelCode] = useState<string | null>(null);
  const [generatedBackgroundCode, setGeneratedBackgroundCode] = useState<string | null>(null);
  const [partsList, setPartsList] = useState<PartInfo[]>([]);
  const [summary, setSummary] = useState<SummaryInfo | null>(null);
  const [expandedStatics, setExpandedStatics] = useState<Set<string>>(new Set());
  const [showDimensions, setShowDimensions] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);
  
  // --- Auto-saving and restoring state ---
  useEffect(() => {
    // On initial load, try to restore state from localStorage
    const savedState = localStorage.getItem('holzbauPlanerState');
    if (savedState) {
        try {
            const restoredState = JSON.parse(savedState);
            if (restoredState.buildingType) {
              // Pre-fill the state but don't advance the step automatically.
              // The user will choose a building type to proceed, and the values will be waiting.
              setBuildingType(restoredState.buildingType);
              setDimensions(restoredState.dimensions || { width: '7.5', depth: '7.5', height: '3', altitude: '750' });
              setRoofType(restoredState.roofType || 'Satteldach');
              setRoofOverhang(restoredState.roofOverhang || '0.8');
              setRoofPitch(restoredState.roofPitch || '30');
            }
        } catch (e) {
            console.error("Could not parse saved state:", e);
            localStorage.removeItem('holzbauPlanerState');
        }
    }
  }, []); // Run only once on initial mount
  
  const saveState = useCallback(() => {
    if (step === 2 && buildingType) {
        const stateToSave = {
            buildingType,
            dimensions,
            roofType,
            roofOverhang,
            roofPitch
        };
        localStorage.setItem('holzbauPlanerState', JSON.stringify(stateToSave));
    }
  }, [buildingType, dimensions, roofType, roofOverhang, roofPitch, step]);
  
  useEffect(saveState, [saveState]);

  // --- Event-Handler ---
  const handleModelError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleSelectBuilding = (type: BuildingType) => {
    setBuildingType(type);
    setStep(2);
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) {
        // When going back to the start, clear everything including saved state
        if (step === 2) {
             setBuildingType(null);
             // Reset dimensions to default when starting over
             setDimensions({ width: '7.5', depth: '7.5', height: '3', altitude: '750' });
             setRoofType('Satteldach');
             setRoofOverhang('0.8');
             setRoofPitch('30');
             localStorage.removeItem('holzbauPlanerState');
        }
        setGeneratedModelCode(null);
        setGeneratedBackgroundCode(null);
        setPartsList([]);
        setSummary(null);
        setStep(step - 1);
    }
  };

  const handleInputChange = useCallback((e: JSX.TargetedEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget;
    setDimensions(prev => ({ ...prev, [name]: value }));
  }, []);
  
  const handleRoofOverhangChange = useCallback((e: JSX.TargetedEvent<HTMLInputElement>) => {
    setRoofOverhang(e.currentTarget.value);
  }, []);
  
  const handleRoofPitchChange = useCallback((e: JSX.TargetedEvent<HTMLInputElement>) => {
    setRoofPitch(e.currentTarget.value);
  }, []);

  const handleRoofChange = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const newRoofType = e.currentTarget.value as RoofType;
    setRoofType(newRoofType);
    if (newRoofType === 'Flachdach') {
        setRoofPitch('5');
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!buildingType) return;
    
    setIsLoading(true);
    setError(null);
    setLoadingMessage("Initialisiere...");

    const isGartenhausLike = buildingType === 'Gartenhaus' || buildingType === 'Sauna' || buildingType === 'Schopf';

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // --- 1. Bestimme strukturelle Konfiguration via KI ---
      setLoadingMessage("Analysiere strukturelle Anforderungen...");
      const numWidth = parseFloat(debouncedDimensions.width) || 0;
      const numDepth = parseFloat(debouncedDimensions.depth) || 0;
      const numOverhang = parseFloat(debouncedRoofOverhang) || 0;
      
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
- Höhe bis Oberkante Wand: ${debouncedDimensions.height}m
- Dach: ${roofType} mit ${debouncedRoofPitch} Grad Neigung
- Standort: ${debouncedDimensions.altitude} m.ü.M.
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
- Höhe: ${debouncedDimensions.height}m
- Dach: ${roofType} mit ${debouncedRoofPitch} Grad Neigung
- Standort: ${debouncedDimensions.altitude} m.ü.M.

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
      setLoadingMessage("Optimiere Balkendimensionen...");
      const standardWidths = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24];
      const standardHeights = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34, 0.36, 0.38, 0.40, 0.44, 0.48, 0.50];
      const getNextStandard = (currentValue: number, standards: number[]) => {
          return standards.find(s => s > currentValue + 0.001) || currentValue + 0.02; // Fallback
      };

      let optimizedDims = {
          postDim: 0.12, // Placeholder, will be overwritten
          beamW: 0.12,
          beamH: 0.12,
          tieBeamH: 0.14, // Separate height for non-structural tie beams, increased for better optics
          rafterW: 0.08,
          rafterH: 0.16,
          braceDim: 0.10,
          counterBattenW: 0.06,
          counterBattenH: 0.08,
          middlePurlinW: 0.12,
          middlePurlinH: 0.16,
          studD: 0.12, // For Gartenhaus
          useKingPosts: true, // Default for Gartenhaus
          ...structuralConfig
      };

      let staticsPassed = false;
      let iterations = 0;
      const MAX_ITERATIONS = 30;

      while(!staticsPassed && iterations < MAX_ITERATIONS) {
          iterations++;
          const tempParams = {
              W: parseFloat(debouncedDimensions.width) || 5, D: parseFloat(debouncedDimensions.depth) || 6, H: parseFloat(debouncedDimensions.height) || 3,
              roofType: roofType, roofOverhang: parseFloat(debouncedRoofOverhang) || 0.5, roofPitch: parseFloat(debouncedRoofPitch) || 15,
              POST_DIM: optimizedDims.postDim,
              BEAM_W: optimizedDims.beamW,
              BEAM_H: optimizedDims.beamH,
              TIE_BEAM_H: optimizedDims.tieBeamH, // Pass to construction plan
              RAFTER_W: optimizedDims.rafterW,
              RAFTER_H: optimizedDims.rafterH,
              BRACE_DIM: optimizedDims.braceDim,
              COUNTER_BATTEN_W: optimizedDims.counterBattenW,
              COUNTER_BATTEN_H: optimizedDims.counterBattenH,
              numberOfPostsPerSide: optimizedDims.numberOfPostsPerSide,
              middlePurlin: optimizedDims.useMiddlePurlin ? { w: optimizedDims.middlePurlinW, h: optimizedDims.middlePurlinH } : null,
              altitude: parseFloat(debouncedDimensions.altitude) || 600,
              STUD_D: optimizedDims.studD, // For Gartenhaus
              useKingPosts: optimizedDims.useKingPosts, // For Gartenhaus
          };
          
          const { partsList: tempList } = isGartenhausLike 
            ? generateGartenhausPlan(tempParams)
            : generateCarportPlan(tempParams);
          
          const checkedList = calculateDeflection(tempList, tempParams);
          const failedParts = checkedList.filter(p => p.statics && !p.statics.passed);
          
          if (failedParts.length === 0) {
              staticsPassed = true;
          } else {
              if (failedParts.some(p => p.key.includes('rafter'))) {
                  optimizedDims.rafterH = getNextStandard(optimizedDims.rafterH, standardHeights);
              }
              if (failedParts.some(p => p.key.includes('plate') || p.key.includes('purlin') || p.key.includes('beam') || p.key.includes('tie_beam') || p.key.includes('top_plate') || p.key.includes('ceiling_joist'))) {
                   optimizedDims.beamH = getNextStandard(optimizedDims.beamH, standardHeights);
              }
              if (failedParts.some(p => p.key.includes('cross_member'))) {
                   optimizedDims.tieBeamH = getNextStandard(optimizedDims.tieBeamH, standardHeights);
              }
              if (failedParts.some(p => p.key.includes('middle_purlin'))) {
                   optimizedDims.middlePurlinH = getNextStandard(optimizedDims.middlePurlinH, standardHeights);
              }
              if (optimizedDims.beamH > optimizedDims.beamW * 2.5 && optimizedDims.beamW < 0.24) { // Increase width if beams become too slender
                   optimizedDims.beamW = getNextStandard(optimizedDims.beamW, standardWidths);
              }
          }
      }

      if (!staticsPassed) {
        throw new Error("Statik-Optimierung konnte nach mehreren Versuchen keine stabile Dimension finden. Bitte überprüfen Sie die Eingabewerte (z.B. sehr grosse Spannweiten).");
      }

      // Enforce post dimension rule: post width/depth = beam width
      optimizedDims.postDim = optimizedDims.beamW;

      // --- 3. Generate 3D Background ---
      setLoadingMessage("Erstelle eine Standard-3D-Umgebung...");
      const genericBackgroundPrompt = `Sie sind ein 3D-Umgebungsdesigner, der JavaScript-Code für Three.js schreibt.
AUFGABE: Erstellen Sie eine ansprechende, generische Landschaftsszene. Sie haben Zugriff auf eine vordefinierte Variable namens \`group\` (eine THREE.Group). Alle von Ihnen erstellten Objekte müssen zu dieser Gruppe hinzugefügt werden.

ANFORDERUNGEN:
1.  **Boden:** Erstellen Sie eine große, grüne \`THREE.PlaneGeometry\` (ca. 100x100), die Schatten empfängt (\`receiveShadow = true\`). Fügen Sie das resultierende Mesh zur \`group\` hinzu.
2.  **Dekoration:** Erstellen Sie 5-10 einfache Bäume. Ein Baum besteht aus einem braunen Zylinder (Stamm) und einem grünen Kegel (Krone). Platzieren Sie die Bäume zufällig, aber VERMEIDEN Sie den zentralen Bereich (x von -10 bis 10 und z von -10 bis 10). Fügen Sie jeden Baum zur \`group\` hinzu.
3.  **Materialien:** Verwenden Sie nur \`THREE.MeshStandardMaterial\` mit einfachen Farben (z.B. 'green' für den Boden, 'darkgreen' für Baumkronen, 'saddlebrown' für Stämme). Verwenden Sie keine Texturen.
4.  **Variablen:** Sie haben Zugriff auf die Variablen \`THREE\` und \`group\`.

ABSOLUTE ANFORDERUNG AN DEN OUTPUT: Liefern Sie NUR den JavaScript-Code-Body. KEINE Funktionsdeklarationen, KEINE \`return\`-Anweisungen, KEINE Markdown-Formatierung wie \`\`\`javascript.`;
      
      const backgroundResult = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: genericBackgroundPrompt });
      setGeneratedBackgroundCode(backgroundResult.text);

      // --- 4. Generiere 3D-Modell und Stückliste mit finalen Dimensionen ---
      setLoadingMessage("Generiere 3D-Modell und technische Pläne...");
      
      const finalModelParams = {
        W: parseFloat(debouncedDimensions.width) || 5,
        D: parseFloat(debouncedDimensions.depth) || 6,
        H: parseFloat(debouncedDimensions.height) || 3,
        roofType: roofType,
        roofOverhang: parseFloat(debouncedRoofOverhang) || 0.5,
        roofPitch: parseFloat(debouncedRoofPitch) || 15,
        POST_DIM: optimizedDims.postDim, 
        BEAM_W: optimizedDims.beamW, 
        BEAM_H: optimizedDims.beamH,
        TIE_BEAM_H: optimizedDims.tieBeamH,
        RAFTER_W: optimizedDims.rafterW, 
        RAFTER_H: optimizedDims.rafterH, 
        BRACE_DIM: optimizedDims.braceDim,
        COUNTER_BATTEN_W: optimizedDims.counterBattenW,
        COUNTER_BATTEN_H: optimizedDims.counterBattenH,
        numberOfPostsPerSide: optimizedDims.numberOfPostsPerSide,
        middlePurlin: optimizedDims.useMiddlePurlin ? { w: optimizedDims.middlePurlinW, h: optimizedDims.middlePurlinH } : null,
        altitude: parseFloat(debouncedDimensions.altitude) || 600,
        STUD_D: optimizedDims.studD,
        useKingPosts: optimizedDims.useKingPosts,
      };
      
      const { mainModelCode, partsList: initialPartsList } = isGartenhausLike
        ? generateGartenhausPlan(finalModelParams)
        : generateCarportPlan(finalModelParams);

      const finalPartsList = calculateDeflection(initialPartsList, finalModelParams);

      // --- 5. Berechne Gesamtgewichte und Lasten für die Zusammenfassung ---
      const WOOD_DENSITY_KG_M3 = 500; // kg/m^3 for Spruce/Fir
      const G = 9.81; // m/s^2
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
              const desc = part.description.replace(/\s+/g, ' '); // Normalize spaces
              const dimMatch = desc.match(/(\d+\.\d+)x(\d+\.\d+)cm, Länge: (\d+\.\d+)cm/);
              if (dimMatch) {
                  const w = parseFloat(dimMatch[1]) / 100;
                  const h = parseFloat(dimMatch[2]) / 100;
                  const l = parseFloat(dimMatch[3]) / 100;
                  totalVolume += w * h * l * part.quantity;
              }
          }
      });
      const totalTimberWeight = totalVolume * WOOD_DENSITY_KG_M3 * G; // Weight in Newtons

      const numAltitude = parseFloat(debouncedDimensions.altitude) || 600;
      const snowLoadGround = (numAltitude / 500 + 0.4) * 0.8 * 1000; // N/m^2
      const projectedRoofArea = (parseFloat(debouncedDimensions.width) || 0) * (parseFloat(debouncedDimensions.depth) || 0);
      const totalSnowLoadOnRoof = snowLoadGround * projectedRoofArea;

      setSummary({
          timberWeight: totalTimberWeight,
          timberVolume: totalVolume,
          snowLoad: totalSnowLoadOnRoof,
          totalLoad: totalTimberWeight + totalSnowLoadOnRoof
      });
      
      setGeneratedModelCode(mainModelCode);
      setPartsList(finalPartsList);
      setStep(3);
    } catch (e) {
      console.error(e);
      let errorMessage = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.message.includes('JSON')) {
        errorMessage = "Die von der KI generierten Konfiguration war fehlerhaft. Bitte versuchen Sie es erneut."
      } else if (e instanceof Error && e.message.includes('429')) {
        errorMessage = "Das Anfragen-Limit wurde überschritten. Bitte versuchen Sie es in Kürze erneut."
      } else if (e instanceof Error && e.message.includes('403')) {
          errorMessage = "Zugriff verweigert (403 PERMISSION_DENIED). Dies deutet auf ein Problem mit dem API-Schlüssel hin (z.B. falsche Domain- oder IP-Einschränkungen). Ihre Eingaben wurden gespeichert.";
      }
      setError(`Ein Fehler ist aufgetreten: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [buildingType, debouncedDimensions, debouncedRoofOverhang, debouncedRoofPitch, roofType]);

  const handleGeneratePdf = useCallback(async () => {
    if (!printRef.current || isGeneratingPdf || !buildingType) return;
    setIsGeneratingPdf(true);
    setLoadingMessage("Erstelle PDF...");
    setError(null);
    
    // Give UI time to update button state
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        await generatePdf(printRef.current, buildingType);
    } catch (err) {
        console.error("PDF generation failed:", err);
        setError("PDF konnte nicht erstellt werden. " + (err instanceof Error ? err.message : ''));
    } finally {
        setIsGeneratingPdf(false);
        setLoadingMessage('');
    }
  }, [isGeneratingPdf, buildingType]);

  return (
    <div className="app-container">
        {(isLoading || isGeneratingPdf) && (
            <div className="loading-overlay">
                <div className="spinner"></div>
                <p>{loadingMessage}</p>
            </div>
        )}
        <header className="app-header">
            <h1>KI Holzbau-Planer</h1>
            <p>Planen Sie Ihr nächstes Holzbauprojekt in Minuten. Von der Idee zum 3D-Modell mit detaillierter Stückliste und Statik-Vorprüfung.</p>
        </header>

        <main>
            {step > 1 && !isLoading && <button onClick={handleBack} className="btn btn-back">← Zurück</button>}
            
            {error && <div className="error-box">{error}</div>}

            {step === 1 && (
                <div className="step-content animate-fade-in">
                    <h2>1. Was möchten Sie bauen?</h2>
                    <div className="card-grid">
                        {BUILDING_TYPES.map(bt => (
                            <div key={bt.name} className="card clickable" onClick={() => handleSelectBuilding(bt.name)}>
                                <span className="card-icon">{bt.icon}</span>
                                <h3>{bt.name}</h3>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {step === 2 && buildingType && (
                 <div className="step-content animate-fade-in">
                    <h2>2. Dimensionen & Eigenschaften für: {buildingType}</h2>
                    <div className="form-grid">
                         <div className="form-group">
                            <label htmlFor="width">Breite (Aussenkante Rahmen) [m]</label>
                            <input id="width" name="width" type="number" step="0.1" value={dimensions.width} onInput={handleInputChange} />
                         </div>
                         <div className="form-group">
                            <label htmlFor="depth">Tiefe (Aussenkante Rahmen) [m]</label>
                            <input id="depth" name="depth" type="number" step="0.1" value={dimensions.depth} onInput={handleInputChange} />
                         </div>
                         <div className="form-group">
                            <label htmlFor="height">Wandhöhe (Oberkante Rähm) [m]</label>
                            <input id="height" name="height" type="number" step="0.05" value={dimensions.height} onInput={handleInputChange} />
                         </div>
                         <div className="form-group">
                            <label htmlFor="altitude">Standort Höhe über Meer [m.ü.M.]</label>
                            <input id="altitude" name="altitude" type="number" step="50" value={dimensions.altitude} onInput={handleInputChange} />
                         </div>
                         <div className="form-group">
                            <label htmlFor="roofType">Dachtyp</label>
                            <select id="roofType" name="roofType" value={roofType} onChange={handleRoofChange}>
                                <option value="Satteldach">Satteldach</option>
                                <option value="Pultdach">Pultdach</option>
                                <option value="Flachdach">Flachdach (geneigt)</option>
                            </select>
                         </div>
                         <div className="form-group">
                            <label htmlFor="roofPitch">Dachneigung [Grad]</label>
                            <input id="roofPitch" name="roofPitch" type="number" min="0" max="60" value={roofPitch} onInput={handleRoofPitchChange} disabled={roofType === 'Flachdach'}/>
                         </div>
                          <div className="form-group">
                            <label htmlFor="roofOverhang">Dachüberstand (längs) [m]</label>
                            <input id="roofOverhang" name="roofOverhang" type="number" step="0.1" value={roofOverhang} onInput={handleRoofOverhangChange} />
                         </div>
                    </div>
                    <button onClick={handleGenerate} className="btn btn-primary btn-generate" disabled={isLoading}>
                         {isLoading ? "Generiere..." : "Plan Erstellen"}
                    </button>
                 </div>
            )}
            
            {step === 3 && generatedModelCode && (
                <div className="results-view animate-fade-in">
                    <div className="viewer-container">
                        <Viewer modelCode={generatedModelCode} backgroundModelCode={generatedBackgroundCode} showDimensions={showDimensions} onError={handleModelError} />
                        <div className="viewer-controls">
                           <div className="control-group">
                             <input type="checkbox" id="show-dims" checked={showDimensions} onChange={() => setShowDimensions(!showDimensions)} />
                             <label htmlFor="show-dims">Masse anzeigen</label>
                           </div>
                        </div>
                    </div>
                    <div className="results-sidebar">
                        <SummaryDisplay summary={summary} altitude={dimensions.altitude} />
                        <div className="parts-list card" ref={printRef}>
                           <div className="parts-list-header">
                             <h3>Stück- & Zuschnittliste</h3>
                             <button onClick={handleGeneratePdf} className="btn btn-secondary" disabled={isGeneratingPdf}>
                                {isGeneratingPdf ? 'Erstelle...' : 'Drucken (PDF)'}
                             </button>
                           </div>
                           <div className="table-wrapper">
                             <table className="parts-table">
                               <thead>
                                 <tr><th>Menge</th><th>Beschreibung & Zeichnung</th></tr>
                               </thead>
                               <tbody>
                                 {partsList.map((part, index) => (
                                    <tr key={part.key + index}>
                                       <td style={{verticalAlign: 'top', textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem'}}>{part.quantity > 1 ? `${part.quantity}x` : ''}</td>
                                       <td>
                                           <div className="part-description">
                                                {part.description.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                                           </div>
                                           {part.statics && <StaticsDisplay 
                                                statics={part.statics} 
                                                isExpanded={expandedStatics.has(part.key)}
                                                onToggle={() => {
                                                    const newSet = new Set(expandedStatics);
                                                    if (newSet.has(part.key)) newSet.delete(part.key);
                                                    else newSet.add(part.key);
                                                    setExpandedStatics(newSet);
                                                }}
                                            />}
                                           {part.drawingInfo && <PartDrawing part={part} index={index} />}
                                           {part.cuttingPlan && <CuttingPlanVisualizer plan={part.cuttingPlan} />}
                                       </td>
                                    </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                        </div>
                    </div>
                </div>
            )}

        </main>
    </div>
  );
};

render(<App />, document.getElementById('app'));