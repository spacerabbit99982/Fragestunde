
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
    setLoadingMessage("Initialisiere und kontaktiere Server für die Planung...");

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                buildingType,
                dimensions: debouncedDimensions,
                roofType,
                roofOverhang: debouncedRoofOverhang,
                roofPitch: debouncedRoofPitch,
            }),
        });

        if (!response.ok) {
            let errorData;
            try {
                 errorData = await response.json();
            } catch(e) {
                throw new Error(`Server antwortete mit Status ${response.status}: ${response.statusText}`);
            }
            throw new Error(errorData.error || `Server antwortete mit Status ${response.status}`);
        }

        const data = await response.json();
        
        setLoadingMessage("Plan empfangen, erstelle 3D-Ansicht...");

        if (!data.generatedModelCode || !data.partsList || !data.summary || !data.generatedBackgroundCode) {
            throw new Error("Unvollständige Daten vom Server empfangen.");
        }

        setSummary(data.summary);
        setGeneratedBackgroundCode(data.generatedBackgroundCode);
        setGeneratedModelCode(data.generatedModelCode);
        setPartsList(data.partsList);
        setStep(3);
    } catch (e) {
      console.error(e);
      let errorMessage = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && (e.message.includes('API-Schlüssel') || e.message.includes('PERMISSION_DENIED'))) {
          errorMessage = "Zugriff verweigert. Dies deutet auf ein Problem mit dem API-Schlüssel auf dem Server hin. Ihre Eingaben wurden gespeichert.";
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
