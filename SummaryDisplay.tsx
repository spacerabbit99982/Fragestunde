import { JSX } from 'preact';
import { SummaryInfo } from './types';

export const SummaryDisplay = ({ summary, altitude }: { summary: SummaryInfo | null, altitude: string }) => {
    if (!summary) return null;
    return (
        <div className="summary-card card">
            <h4>Zusammenfassung</h4>
            <div className="summary-grid">
                <div>
                    <label>Holzvolumen</label>
                    <p>{summary.timberVolume.toFixed(2)} m³</p>
                </div>
                <div>
                    <label>Holzgewicht (ca.)</label>
                    <p>{(summary.timberWeight / 1000).toFixed(2)} kN</p>
                </div>
                <div>
                    <label>Schneelast (Dachfläche)</label>
                    <p>{(summary.snowLoad / 1000).toFixed(2)} kN</p>
                </div>
                 <div>
                    <label>Gesamtlast (ca.)</label>
                    <p>{(summary.totalLoad / 1000).toFixed(2)} kN</p>
                </div>
            </div>
            <p className="info-text">
                Angenommene Dichte für Fichte/Tanne C24: ca. 500 kg/m³. Schneelast am Boden auf {altitude} m.ü.M. berechnet. Dach-Eigengewicht (Ziegel etc.) nicht berücksichtigt.
            </p>
        </div>
    );
};
