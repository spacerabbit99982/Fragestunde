import { JSX } from 'preact';
import { useRef, useState, useEffect, useLayoutEffect } from 'preact/hooks';
import { PartInfo, CuttingPlan } from './types';

// Sub-component to render text with a background for better readability
const DimensionLabel = ({ x, y, children, transform: textTransform = "" }) => {
    const textRef = useRef<SVGTextElement>(null);
    const [bbox, setBbox] = useState<DOMRect | null>(null);

    useLayoutEffect(() => {
        if (textRef.current) {
            setBbox(textRef.current.getBBox());
        }
    }, [children]);

    const padding = { x: 4, y: 2 };

    return (
        <g>
            {bbox && (
                <rect
                    x={bbox.x - padding.x}
                    y={bbox.y - padding.y}
                    width={bbox.width + 2 * padding.x}
                    height={bbox.height + 2 * padding.y}
                    className="dimension-text-bg"
                />
            )}
            <text
                ref={textRef}
                className="dimension-text"
                x={x}
                y={y}
                dominant-baseline="central"
                text-anchor="middle"
                transform={textTransform}
            >
                {children}
            </text>
        </g>
    );
};


export const PartDrawing = ({ part, index }: { part: PartInfo, index: number }) => {
    const { drawingInfo, description } = part;
    if (!drawingInfo || !drawingInfo.points || drawingInfo.points.length === 0) return null;

    const scale = 150;
    const { points, dimensions = [], markers = [], referenceLines = [] } = drawingInfo;
    
    const geometryBbox = points.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    
    if (geometryBbox.minX === Infinity) return null;

    const transformX = (x: number) => x * scale;
    const transformY = (y: number) => -y * scale;
    
    const shapeSvgBbox = {
        minX: geometryBbox.minX * scale,
        maxX: geometryBbox.maxX * scale,
        minY: transformY(geometryBbox.maxY),
        maxY: transformY(geometryBbox.minY),
    };

    const horizontalDimOffsetsToAlign = [80, 50, -80, -110];
    const alignedYLineMap = new Map<number, number>();

    horizontalDimOffsetsToAlign.forEach(offset => {
        if (offset > 0) {
            alignedYLineMap.set(offset, shapeSvgBbox.minY - offset);
        } else {
            alignedYLineMap.set(offset, shapeSvgBbox.maxY - offset);
        }
    });

    let comprehensiveSvgBbox = { ...shapeSvgBbox };

    const expandBbox = (x: number, y: number) => {
        comprehensiveSvgBbox.minX = Math.min(comprehensiveSvgBbox.minX, x);
        comprehensiveSvgBbox.maxX = Math.max(comprehensiveSvgBbox.maxX, x);
        comprehensiveSvgBbox.minY = Math.min(comprehensiveSvgBbox.minY, y);
        comprehensiveSvgBbox.maxY = Math.max(comprehensiveSvgBbox.maxY, y);
    };

    referenceLines.forEach(line => {
        expandBbox(transformX(line.p1.x), transformY(line.p1.y));
        expandBbox(transformX(line.p2.x), transformY(line.p2.y));
    });
    
    dimensions.forEach(dim => {
        const x1 = transformX(dim.p1.x);
        const y1 = transformY(dim.p1.y);
        const x2 = transformX(dim.p2.x);
        const y2 = transformY(dim.p2.y);

        if (dim.type === 'linear_horizontal') {
            let y_dim_line = alignedYLineMap.get(dim.offset);
            if (y_dim_line === undefined) {
                 if (dim.offset > 0) {
                    y_dim_line = shapeSvgBbox.minY - dim.offset;
                 } else {
                    y_dim_line = shapeSvgBbox.maxY - dim.offset;
                 }
            }

            const text_y = y_dim_line + (dim.offset > 0 ? -4 : 14);
            expandBbox(x1, y1); expandBbox(x2, y2);
            expandBbox(x1, y_dim_line); expandBbox(x2, y_dim_line);
            expandBbox((x1 + x2) / 2, text_y - 10); expandBbox((x1 + x2) / 2, text_y + 10);

        } else if (dim.type === 'linear_vertical') {
            const x_dim_line = x1 + dim.offset;
            const text_x = x_dim_line + (dim.offset > 0 ? 4 : -4);
            const text_y = (y1 + y2) / 2;

            expandBbox(x_dim_line, y1); expandBbox(x_dim_line, y2);
            expandBbox(x1, y1); expandBbox(x1, y2);
            expandBbox(text_x - 30, text_y); expandBbox(text_x + 30, text_y);
        } else if (dim.type === 'angular') {
            const t_center_x = transformX(dim.center.x);
            const t_center_y = transformY(dim.center.y);
            const radius = dim.radius;
            expandBbox(t_center_x - radius, t_center_y - radius);
            expandBbox(t_center_x + radius, t_center_y + radius);
        } else if (dim.type === 'linear_aligned') {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return;

            const perp_dx = -dy / len;
            const perp_dy = dx / len;
            const x_dim_1 = x1 + perp_dx * dim.offset;
            const y_dim_1 = y1 + perp_dy * dim.offset;
            const x_dim_2 = x2 + perp_dx * dim.offset;
            const y_dim_2 = y2 + perp_dy * dim.offset;

            expandBbox(x_dim_1, y_dim_1);
            expandBbox(x_dim_2, y_dim_2);
        }
    });

    if (comprehensiveSvgBbox.minX === Infinity) return null;

    const viewBoxPadding = 20;
    const viewBoxX = comprehensiveSvgBbox.minX - viewBoxPadding;
    const viewBoxY_initial = comprehensiveSvgBbox.minY - viewBoxPadding;
    const svgWidth = (comprehensiveSvgBbox.maxX - comprehensiveSvgBbox.minX) + 2 * viewBoxPadding;
    const svgHeight_initial = (comprehensiveSvgBbox.maxY - comprehensiveSvgBbox.minY) + 2 * viewBoxPadding;
    
    if (svgWidth <= 0 || svgHeight_initial <= 0) return null;

    const shapeWidth = shapeSvgBbox.maxX - shapeSvgBbox.minX;
    const shapeHeight = Math.max(1, shapeSvgBbox.maxY - shapeSvgBbox.minY);
    const shapeAspectRatio = shapeWidth / shapeHeight;

    const targetAspectRatio = 3.0;

    let viewBoxY = viewBoxY_initial;
    let svgHeight = svgHeight_initial;

    if (shapeAspectRatio > targetAspectRatio) {
        const desiredHeight = svgWidth / targetAspectRatio;
        if (desiredHeight > svgHeight_initial) {
             const verticalPadding = (desiredHeight - svgHeight_initial) / 2;
             viewBoxY -= verticalPadding;
             svgHeight = desiredHeight;
        }
    }

    const pathData = "M " + points.map(p => `${transformX(p.x).toFixed(1)} ${transformY(p.y).toFixed(1)}`).join(" L ") + " Z";

    const maxPixelWidth = 600;
    const finalWidth = Math.min(maxPixelWidth, svgWidth);
    const finalAspectRatio = svgWidth / svgHeight;
    const finalHeight = finalWidth / finalAspectRatio;
    const containerHeight = Math.max(finalHeight, 150);

    return (
        <div style={{ width: `100%`, maxWidth: `${finalWidth}px`, height: `${containerHeight}px`, margin: '2.5rem 0 1rem 0' }}>
            <svg 
                width="100%" 
                height="100%"
                viewBox={`${viewBoxX} ${viewBoxY} ${svgWidth} ${svgHeight}`}
                preserveAspectRatio="xMidYMid meet"
                aria-label={`Zeichnung von: ${description}`}
            >
                <defs>
                    <marker id={`arrow-${index}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" className="dimension-arrow" />
                    </marker>
                </defs>
                <path d={pathData} fill="#f0e0c8" stroke="#7f5539" stroke-width="1" vector-effect="non-scaling-stroke" />
                
                {referenceLines.map((line, i) => (
                    <line
                        key={`refline-${i}`}
                        className={line.style === 'dashed' ? 'reference-line-dashed' : 'reference-line'}
                        x1={transformX(line.p1.x)}
                        y1={transformY(line.p1.y)}
                        x2={transformX(line.p2.x)}
                        y2={transformY(line.p2.y)}
                    />
                ))}

                {markers.map((marker, i) => {
                    const localBbox = drawingInfo.bbox;
                    const isRafter = part.key.includes('rafter');
                    if (marker.orientation === 'vertical') {
                        const x = transformX(isRafter ? marker.position : (localBbox.minX + marker.position));
                        const y_start = transformY(localBbox.maxY);
                        const y_end = transformY(localBbox.minY);
                        return (
                            <g key={`marker-${i}`}>
                                <line className="marker" x1={x} y1={y_start} x2={x} y2={y_end} />
                                {marker.text && <text className="marker-text" x={x} y={y_end - 10} transform={`rotate(-45, ${x}, ${y_end - 10})`}>{marker.text}</text>}
                            </g>
                        );
                    } else { // horizontal
                        const y = transformY(isRafter ? marker.position : (localBbox.minY + marker.position));
                        const x_start = transformX(localBbox.minX);
                        const x_end = transformX(localBbox.maxX);
                        return (
                            <g key={`marker-${i}`}>
                                <line className="marker" x1={x_start} y1={y} x2={x_end} y2={y} />
                                {marker.text && <text className="marker-text" x={x_start - 10} y={y} dominant-baseline="middle" text-anchor="end">{marker.text}</text>}
                            </g>
                        );
                    }
                })}

                {dimensions.map((dim, i) => {
                    const x1 = transformX(dim.p1.x), y1 = transformY(dim.p1.y);
                    const x2 = transformX(dim.p2.x), y2 = transformY(dim.p2.y);
                    
                    if (dim.type === 'linear_horizontal') {
                        let y_dim_line = alignedYLineMap.get(dim.offset);
                        if (y_dim_line === undefined) {
                            const isBelow = dim.offset < 0;
                            const referenceY = isBelow ? shapeSvgBbox.maxY : shapeSvgBbox.minY;
                            y_dim_line = referenceY - dim.offset;
                        }
                        const text_y = y_dim_line + (dim.offset > 0 ? -4 : 14);
                        
                        return (
                           <g key={i} className="dimension">
                                <line className="extension-line" x1={x1} y1={y1} x2={x1} y2={y_dim_line + (dim.offset > 0 ? 5 : -5)} />
                                <line className="extension-line" x1={x2} y1={y2} x2={x2} y2={y_dim_line + (dim.offset > 0 ? 5 : -5)} />
                                <line className="dimension-line" marker-start={`url(#arrow-${index})`} marker-end={`url(#arrow-${index})`} x1={x1} y1={y_dim_line} x2={x2} y2={y_dim_line} />
                                {dim.label && <DimensionLabel x={(x1 + x2) / 2} y={text_y}>{dim.label}</DimensionLabel>}
                           </g>
                        );
                    } else if (dim.type === 'linear_vertical') {
                        const x_dim_line = x1 + dim.offset;
                        const text_x = x_dim_line + (dim.offset > 0 ? 4 : -4);
                        const text_y = (y1 + y2) / 2;
                        
                        return (
                           <g key={i} className="dimension">
                                <line className="extension-line" x1={x1} y1={y1} x2={x_dim_line + (dim.offset > 0 ? -5 : 5)} y2={y1} />
                                <line className="extension-line" x1={x2} y1={y2} x2={x_dim_line + (dim.offset > 0 ? -5 : 5)} y2={y2} />
                                <line className="dimension-line" marker-start={`url(#arrow-${index})`} marker-end={`url(#arrow-${index})`} x1={x_dim_line} y1={y1} x2={x_dim_line} y2={y2} />
                                {dim.label && <DimensionLabel x={text_x} y={text_y} transform={`rotate(-90, ${text_x}, ${text_y})`}>{dim.label}</DimensionLabel>}
                           </g>
                        );
                    } else if (dim.type === 'linear_aligned') {
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const len = Math.hypot(dx, dy);
                        if (len < 1e-6) return null;

                        const offsetSign = Math.sign(dim.offset);
                        const effectiveOffset = Math.abs(dim.offset);

                        const perp_dx = -dy / len;
                        const perp_dy = dx / len;

                        const x_dim_1 = x1 + perp_dx * effectiveOffset * offsetSign;
                        const y_dim_1 = y1 + perp_dy * effectiveOffset * offsetSign;
                        const x_dim_2 = x2 + perp_dx * effectiveOffset * offsetSign;
                        const y_dim_2 = y2 + perp_dy * effectiveOffset * offsetSign;

                        const labelOffsetAmount = 14;
                        const text_x = (x_dim_1 + x_dim_2) / 2 + perp_dx * labelOffsetAmount * offsetSign;
                        const text_y = (y_dim_1 + y_dim_2) / 2 + perp_dy * labelOffsetAmount * offsetSign;

                        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
                        if (angle > 90) angle -= 180;
                        if (angle < -90) angle += 180;
                        
                        const extLineGap = 5;
                        const x_ext_1_end = x1 + perp_dx * (effectiveOffset - extLineGap) * offsetSign;
                        const y_ext_1_end = y1 + perp_dy * (effectiveOffset - extLineGap) * offsetSign;
                        const x_ext_2_end = x2 + perp_dx * (effectiveOffset - extLineGap) * offsetSign;
                        const y_ext_2_end = y2 + perp_dy * (effectiveOffset - extLineGap) * offsetSign;

                        return (
                           <g key={i} className="dimension">
                                <line className="extension-line" x1={x1} y1={y1} x2={x_ext_1_end} y2={y_ext_1_end} />
                                <line className="extension-line" x1={x2} y1={y2} x2={x_ext_2_end} y2={y_ext_2_end} />
                                <line className="dimension-line" marker-start={`url(#arrow-${index})`} marker-end={`url(#arrow-${index})`} x1={x_dim_1} y1={y_dim_1} x2={x_dim_2} y2={y_dim_2} />
                                {dim.label && <DimensionLabel x={text_x} y={text_y} transform={`rotate(${angle}, ${text_x}, ${text_y})`}>{dim.label}</DimensionLabel>}
                           </g>
                        );
                    } else if (dim.type === 'angular') {
                        const t_center = { x: transformX(dim.center.x), y: transformY(dim.center.y) };
                        const t_p1 = { x: transformX(dim.p1.x), y: transformY(dim.p1.y) };
                        const t_p2 = { x: transformX(dim.p2.x), y: transformY(dim.p2.y) };

                        const v1_svg = { x: t_p1.x - t_center.x, y: t_p1.y - t_center.y };
                        const v2_svg = { x: t_p2.x - t_center.x, y: t_p2.y - t_center.y };

                        const mag1 = Math.hypot(v1_svg.x, v1_svg.y);
                        const mag2 = Math.hypot(v2_svg.x, v2_svg.y);

                        if (mag1 < 1e-6 || mag2 < 1e-6) return null;

                        const crossProduct = v1_svg.x * v2_svg.y - v1_svg.y * v2_svg.x;
                        const sweepFlag = crossProduct > 0 ? '1' : '0';
                        const largeArcFlag = '0';

                        const arcStart = { x: t_center.x + (v1_svg.x / mag1) * dim.radius, y: t_center.y + (v1_svg.y / mag1) * dim.radius };
                        const arcEnd   = { x: t_center.x + (v2_svg.x / mag2) * dim.radius, y: t_center.y + (v2_svg.y / mag2) * dim.radius };
                        const arcPath = `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${dim.radius} ${dim.radius} 0 ${largeArcFlag} ${sweepFlag} ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;
                        
                        const nv1 = { x: v1_svg.x / mag1, y: v1_svg.y / mag1 };
                        const nv2 = { x: v2_svg.x / mag2, y: v2_svg.y / mag2 };
                        let midVec = { x: nv1.x + nv2.x, y: nv1.y + nv2.y };
                        const magMid = Math.hypot(midVec.x, midVec.y);

                        if (magMid < 1e-6) {
                            midVec = { x: -nv1.y, y: nv1.x };
                        }
                        const magMidNormalized = Math.hypot(midVec.x, midVec.y);
                        if (magMidNormalized < 1e-6) return null;

                        const labelOffsetAmount = 14;
                        const text_x = t_center.x + (midVec.x / magMidNormalized) * (dim.radius + labelOffsetAmount);
                        const text_y = t_center.y + (midVec.y / magMidNormalized) * (dim.radius + labelOffsetAmount);

                        return (
                           <g key={i} className="dimension">
                               <path d={arcPath} className="dimension-line no-fill" marker-start={`url(#arrow-${index})`} marker-end={`url(#arrow-${index})`} />
                               <DimensionLabel x={text_x} y={text_y}>{dim.label}</DimensionLabel>
                           </g>
                        );
                    }
                    return null;
                })}

            </svg>
        </div>
    );
};

export const CuttingPlanVisualizer = ({ plan }: { plan: CuttingPlan }) => {
    if (!plan || !plan.bins || plan.bins.length === 0) {
        return null;
    }

    const { stockLength, kerf, bins } = plan;

    return (
        <div className="cutting-plan-visualizer" style={{ marginTop: '0.5rem', marginBottom: '1rem', fontFamily: 'sans-serif' }}>
            {bins.map((bin, binIndex) => {
                let totalUsedLength = 0;
                const cutsAndKerfs: {type: 'cut' | 'kerf', length: number}[] = [];

                bin.cuts.forEach((cut, i) => {
                    cutsAndKerfs.push({ type: 'cut', length: cut });
                    totalUsedLength += cut;
                    if (i < bin.cuts.length - 1) {
                        cutsAndKerfs.push({ type: 'kerf', length: kerf });
                        totalUsedLength += kerf;
                    }
                });

                const waste = stockLength - totalUsedLength;
                const binKey = `${binIndex}-${bin.count}-${bin.cuts.join('-')}`;
                
                return (
                    <div key={binKey} className="cutting-plan-bin" style={{ marginBottom: '0.5rem' }}>
                         <div className="stock-bar" title={`Visueller Zuschnittplan für eine ${stockLength.toFixed(1)}m Stange`} style={{ display: 'flex', height: '30px', backgroundColor: '#e0e0e0', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden', width: '100%', maxWidth: '400px' }}>
                            {cutsAndKerfs.map((item, itemIndex) => (
                                <div
                                    key={itemIndex}
                                    style={{
                                        width: `${(item.length / stockLength) * 100}%`,
                                        backgroundColor: item.type === 'cut' ? '#a5d6a7' : '#ef9a9a',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        overflow: 'hidden',
                                        borderRight: item.type === 'kerf' ? 'none' : '1px solid #888',
                                        boxSizing: 'border-box'
                                    }}
                                    title={item.type === 'cut' ? `Zuschnitt: ${(item.length * 100).toFixed(1)} cm` : `Sägeschnitt: ${(kerf * 1000)} mm`}
                                >
                                    {item.type === 'cut' && item.length > stockLength * 0.1 && (
                                        <span style={{ fontSize: '10px', color: '#1b5e20', whiteSpace: 'nowrap' }}>
                                            {(item.length * 100).toFixed(1)}
                                        </span>
                                    )}
                                </div>
                            ))}
                            {waste > 0.01 && (
                                <div
                                    style={{ width: `${(waste / stockLength) * 100}%`, backgroundColor: '#f5f5f5' }}
                                    title={`Rest: ${(waste * 100).toFixed(1)} cm`}
                                ></div>
                            )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
                            {bin.count > 1 ? `${bin.count}x ` : ''}
                            {`${stockLength.toFixed(1)}m Stange: `}
                            {bin.cuts.map(c => `${(c * 100).toFixed(1)}cm`).join(' + ')}
                            {waste > 0.01 && ` (Rest: ${(waste * 100).toFixed(1)}cm)`}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};