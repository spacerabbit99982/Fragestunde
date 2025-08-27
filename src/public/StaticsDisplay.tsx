import { JSX } from 'preact';
import { StaticsInfo } from './types';

export const StaticsDisplay = ({ statics, isExpanded, onToggle }: { statics: StaticsInfo, isExpanded: boolean, onToggle: () => void }) => {
    const { span, load, pointLoad, maxDeflection, allowedDeflection, passed, formula, formulaDescription } = statics;
    const utilization = (maxDeflection / allowedDeflection) * 100;

    return (
        <div className="statics-container">
            <div className="statics-summary" onClick={onToggle} role="button" aria-expanded={isExpanded} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}>
                <span className={passed ? "statics-ok" : "statics-fail"}>
                    Statik: {passed ? "OK" : "Nicht OK"} ({utilization.toFixed(0)}%)
                </span>
                <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
            </div>
            {isExpanded && (
                <div className="statics-details">
                    <p><strong>Spannweite:</strong> {(span * 100).toFixed(1)} cm</p>
                    <p><strong>Last (q):</strong> {(load / 1000).toFixed(2)} kN/m</p>
                    {pointLoad && <p><strong>Punktlast (P):</strong> {(pointLoad / 1000).toFixed(2)} kN</p>}
                    <p><strong>Max. Durchbiegung:</strong> {(maxDeflection * 1000).toFixed(2)} mm</p>
                    <p><strong>Erlaubte Durchbiegung:</strong> {(allowedDeflection * 1000).toFixed(2)} mm (L/300)</p>
                    <div className="formula-details">
                        <p><strong>Verwendete Formel:</strong></p>
                        <p><code>{formula}</code></p>
                        <ul>
                            {formulaDescription.split('\n').map((line, i) => <li key={i}>{line}</li>)}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};