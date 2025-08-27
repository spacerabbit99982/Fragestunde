import { JSX } from 'preact';
import { SummaryInfo } from './types';

const formatNumber = (num: number, unit: string, decimals = 2) => {
    if (isNaN(num)) return `--- ${unit}`;
    return `${num.toFixed(decimals)} ${unit}`;
};

export const SummaryDisplay = ({ summary, altitude }: { summary: SummaryInfo | null, altitude: string }) => {
    if (!summary) {
        return <div className="summary-card card">Lade Zusammenfassung...</div>;
    }

    const { timberWeight, timberVolume, snowLoad, totalLoad } = summary;
    const g = 9.81;

    return (
        <div className="summary-card card">
            <h4>Projekt-Zusammenfassung</h4>
            <div className="summary-grid">
                <div>
                    <label>Holzvolumen</label>
                    <p>{formatNumber(timberVolume, 'm³')}</p>
                </div>
                <div>
                    <label>Gewicht Holz</label>
                    <p>{formatNumber(timberWeight / g / 1000, 't', 2)}</p>
                </div>
                <div>
                    <label>Schneelast (Dach)</label>
                    <p>{formatNumber(snowLoad / g / 1000, 't', 2)}</p>
                </div>
                 <div>
                    <label>Gesamtlast (Dach)</label>
                    <p>{formatNumber(totalLoad / g / 1000, 't', 2)}</p>
                </div>
            </div>
            <p className="info-text">
                Die Schneelast ist eine Schätzung basierend auf der Schweizer Norm für den Standort auf {altitude} m.ü.M. und dient nur zur Vordimensionierung. Eine detaillierte Statik durch einen Fachingenieur ist erforderlich.
            </p>
        </div>
    );
};