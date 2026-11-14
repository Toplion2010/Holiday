export type XY = [number, number]
export type Mode = 'walk' | 'rover'
export type Objective = 'shortest' | 'fastest' | 'risk' | 'science' | 'balanced'
export interface Config {
  base: XY; mode: Mode; oxygen: number; suitWh: number; roverWh: number; duration: number;
  reserve: number; autoReturn: boolean; speed: number; oxygenRate: number; suitW: number;
  driveW: number; departure: string; objective: string; tools: string[]; roverCondition: 'nominal'|'degraded';
}
export interface Activity { id: string; name: string; seconds: number; value: number; tool: string }
export interface Target {
  id: string; name: string; xy: XY; observedXY: XY; purpose: string; source: string;
  uncertainty: number; activities: Activity[]; selected: string; required: boolean; theme: string;
  date: string; sol: number; locationNote: string;
}
export interface Leg {
  from: string; to: string; cells: number[]; coords: XY[]; elevations: number[];
  seconds: number; distance: number; risk: number; mode: Mode; stepSeconds: number[];
  oxygen: number; suitWh: number; roverWh: number;
}
export interface Work { target: string; activity: string; name: string; seconds: number; value: number; tool: string; theme: string }
export interface Plan {
  id: Objective; legs: Leg[]; targets: string[]; work: Work[]; seconds: number; travelSeconds: number;
  distance: number; oxygen: number; suitWh: number; roverWh: number; value: number; feasible: boolean;
  reasons: string[]; margins: { oxygen: number; suitWh: number; roverWh: number; time: number };
  explanation: string; revision: number; skipped: string[]; start: XY; stateKey: string;
  roverDependencies: {xy:XY; feasible:boolean; oxygenMargin:number; suitMargin:number}[];
}
export interface Log { at: number; kind: string; text: string; data?: unknown }
export type Fault = 'slow'|'delay'|'obstacle'|'leak'|'wheel'|'failure'|'battery'|'suit'|'confidence'|'comms'|'unresponsive'
export interface State {
  config: Config; position: XY; rover: XY; aboard: boolean; elapsed: number; oxygen: number;
  suitWh: number; roverWh: number; running: boolean; speed: number; status: string; plan: Plan|null;
  leg: number; step: number; segmentElapsed: number; activityElapsed: number; completed: Record<string,string>;
  completedThemes: Record<string,number>; science: number; actual: XY[]; log: Log[];
  faults: Partial<Record<Fault,boolean>>; revision: number; obstacles: XY[]; pending: Plan|null;
  returnPlan: Plan|null; returnPending: boolean; assisted: boolean; heading: number;
}
