import type { Config,State,Target,Activity,Mode } from './types'
export const DEFAULT_CONFIG: Config = {
  base:[0,0], mode:'walk', oxygen:1.5, suitWh:1600, roverWh:8000, duration:8*3600,
  reserve:0.2, autoReturn:false, speed:0.7, oxygenRate:0.000035, suitW:160, driveW:700,
  departure:'2026-11-14T06:00', objective:'groundwater', tools:['camera','spectrometer','sampler'],roverCondition:'nominal',
}
export const ACTIVITIES: Activity[] = [
  {id:'photo',name:'Overview photograph',seconds:120,value:8,tool:'camera'},
  {id:'survey',name:'Detailed photographic survey',seconds:600,value:20,tool:'camera'},
  {id:'measure',name:'Instrument measurement',seconds:900,value:28,tool:'spectrometer'},
  {id:'sample',name:'Sample collection',seconds:1800,value:40,tool:'sampler'},
]
export const SCORING = { relevance:1.4, complement:1.2, redundancy:0.65 }
export function scienceValue(t:Target,a:Activity,objective:string,themes:Record<string,number>) {
  const relevance=t.theme===objective?SCORING.relevance:1;
  const count=themes[t.theme]??0;
  const complement=count===0&&Object.keys(themes).length?SCORING.complement:1;
  return Math.round(a.value*relevance*complement*Math.pow(SCORING.redundancy,count));
}
export function rates(s:State,mode:Mode|'work',grade=0) {
  const effort=mode==='walk'?1+Math.max(0,grade)*5:0.8;
  return {oxygen:s.config.oxygenRate*effort*(s.faults.leak?2:1),suitWh:s.config.suitW/3600,roverWh:mode==='rover'?s.config.driveW/3600:0};
}
export function speedFactor(s:State,mode:Mode) {
  return mode==='walk'?(s.config.speed/Math.exp(-3.5*0.05))/(s.faults.slow?1.6:1)
    :1/((s.faults.wheel||s.config.roverCondition==='degraded')?1.7:1);
}
export function stateKey(s:State) {return JSON.stringify([s.position,s.rover,s.aboard,s.elapsed,s.oxygen,s.suitWh,s.roverWh,s.revision,s.faults,s.completed,s.config])}
export function validateConfig(c:Config):string[] {
  const errors:string[]=[];
  for(const k of ['oxygen','suitWh','roverWh','duration','speed','oxygenRate','suitW','driveW'] as const)
    if(!Number.isFinite(c[k])||c[k]<=0)errors.push(k+' must be positive');
  if(c.speed>2)errors.push('Walking speed must be at most 2 m/s');
  if(c.duration>24*3600)errors.push('Scenario duration is limited to 24 hours');
  if(!(c.reserve>=0.05&&c.reserve<=0.8))errors.push('Reserve must be between 5% and 80%');
  if(!c.base.every(Number.isFinite))errors.push('Base coordinates are invalid');
  if(!Number.isFinite(Date.parse(c.departure+'Z')))errors.push('Departure UTC date is invalid');
  return errors;
}
