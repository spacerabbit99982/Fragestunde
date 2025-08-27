import { JSX } from 'preact';
import { StaticsInfo } from './types';

export const StaticsDisplay = ({ statics, isExpanded, onToggle }: { statics: StaticsInfo, isExpanded: boolean, onToggle: () => void }) => {
    if (!statics || statics.span === 0) {
        return <div className="statics-container"><span className="statics-ok">Statik nicht relevant</span></div>;
    }
    const { passed, maxDeflection, allowedDeflection, formula, formulaDescription, pointLoad } = statics;
    const deflectionRatio = (maxDeflection / allowedDeflection) * 100;

    return (
        <div className="statics-container">
            <div className={`statics-summary ${passed ? 'statics-ok' : 'statics-fail'}`} onClick={onToggle} role="button" tabIndex={0} onKeyPress={(e) => e.key === 'Enter' && onToggle()}>
                <span>
                    Statik: {passed ? 'OK' : 'FEHLSCHLAG'} ({(deflectionRatio).toFixed(0)}%)
                </span>
                <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
            </div>
            {isExpanded && (
                <div className="statics-details animate-fade-in">
                    <p>Max. Durchbiegung: <strong>{(maxDeflection * 1000).toFixed(2)} mm</strong></p>
                    <p>Erlaubte Durchbiegung: <strong>{(allowedDeflection * 1000).toFixed(2)} mm</strong></p>
                    <p>Spannweite: <strong>{(statics.span).toFixed(2)} m</strong></p>
                    <p>Gleichlast (q): <strong>{(statics.load / 1000).toFixed(2)} kN/m</strong></p>
                    {pointLoad && <p>Punktlast (P): <strong>{(pointLoad / 1000).toFixed(2)} kN</strong></p>}
                    <div className="formula-details">
                        <p><strong>{formula}</strong></p>
                        {formulaDescription.split('\n').map((line, i) => <p key={i} style={{fontSize: '0.8rem', color: '#6b7280', margin: '0.2rem 0'}}>{line}</p>)}
                        <ul>
                            <li>E = {(statics.eModulus / 1e9).toFixed(0)} GPa (Elastizitätsmodul)</li>
                            <li>I = {(statics.inertia * 1e9).toExponential(2)} mm⁴ (Flächenträgheitsmoment)</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};
