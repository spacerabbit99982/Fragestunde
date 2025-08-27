// --- Typen und Konstanten ---
export type BuildingType = 'Carport' | 'Gartenhaus' | 'Sauna' | 'Schopf';
export type RoofType = 'Flachdach' | 'Satteldach' | 'Pultdach';

export type Marker = {
    position: number;
    orientation: 'vertical' | 'horizontal';
    text?: string;
};

export type Dimension = {
    type: 'linear_horizontal' | 'linear_vertical' | 'linear_aligned';
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    offset: number;
    label?: string;
} | {
    type: 'angular';
    center: { x: number; y: number };
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    radius: number;
    label: string;
};

export type ReferenceLine = {
    p1: { x: number, y: number };
    p2: { x: number, y: number };
    style?: 'solid' | 'dashed';
}

export type DrawingInfo = {
    points: { x: number, y: number }[];
    bbox: { minX: number, maxX: number, minY: number, maxY: number };
    depth: number;
    dimensions?: Dimension[];
    markers?: Marker[];
    referenceLines?: ReferenceLine[];
};

export type StaticsInfo = {
    span: number;
    load: number; // UDL q in N/m
    pointLoad?: number; // Point load P in N
    maxDeflection: number;
    allowedDeflection: number;

    passed: boolean;
    inertia: number;
    eModulus: number;
    formula: string;
    formulaDescription: string;
};

export type CuttingPlan = {
    stockLength: number;
    kerf: number;
    bins: {
        cuts: number[];
        count: number;
    }[];
};

export type PartInfo = { 
  key: string, 
  quantity: number, 
  description: string,
  drawingInfo?: DrawingInfo,
  statics?: StaticsInfo,
  cuttingPlan?: CuttingPlan,
};

export type SummaryInfo = {
    timberWeight: number;
    timberVolume: number;
    snowLoad: number;
    totalLoad: number;
};


export const BUILDING_TYPES: { name: BuildingType, icon: string }[] = [
  { name: 'Carport', icon: '🚗' },
  { name: 'Gartenhaus', icon: '🏡' },
  { name: 'Sauna', icon: '🔥' },
  { name: 'Schopf', icon: '🛠️' },
];