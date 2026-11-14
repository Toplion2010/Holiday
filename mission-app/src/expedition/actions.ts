import { accept,initial,inject,manualMove,record,tick } from './engine'
import {stateKey} from './model'
import type {State,Config,Plan,Fault,XY} from './types'
export type Action = {type:'tick';seconds:number}|{type:'running';value:boolean}|{type:'speed';value:number}|{type:'accept';plan:Plan;emergency?:boolean}|{type:'fault';fault:Fault;point?:XY}|{type:'return';plan:Plan;key:string}|{type:'propose';plan:Plan}|{type:'move';to:XY;seconds:number;grade:number}|{type:'heading';value:number}|{type:'board'}|{type:'note';text:string}|{type:'manual'}|{type:'abort'}
export function reduce(s:State,a:Action):State {
  if(a.type==='tick')return tick(s,a.seconds);
  if(a.type==='accept')return accept(s,a.plan,a.emergency);
  if(a.type==='fault')return inject(s,a.fault,a.point);
  if(a.type==='move')return manualMove(s,a.to,a.seconds,a.grade);
  const n=structuredClone(s);
  if(a.type==='running'){if(a.value&&(s.status==='Completed'||s.status==='No feasible return found'||s.faults.unresponsive&&!(s.config.autoReturn&&s.aboard&&!s.faults.failure&&s.plan&&!s.plan.work.length)))return s;n.running=a.value;record(n,'control',a.value?'Simulation resumed':'Simulation paused')}
  if(a.type==='speed')n.speed=a.value;
  if(a.type==='heading')n.heading=a.value;
  if(a.type==='manual'){n.assisted=false;n.plan=null;n.pending=null;record(n,'control','Manual traversal selected')}
  if(a.type==='abort'){n.status='Abort';n.running=false;n.plan=null;n.pending=null;record(n,'abort','Optional science stopped; return requested')}
  if(a.type==='board'){
    if(n.aboard)n.aboard=false;
    else if(!n.faults.failure&&Math.hypot(n.position[0]-n.rover[0],n.position[1]-n.rover[1])<3&&n.roverWh>0)n.aboard=true;
    else{record(n,'rejected','Rover must be working and within 3 m to board');return n}
    n.running=false;n.plan=null;n.returnPending=true;record(n,'transport',n.aboard?'Boarded unpressurized rover':'Disembarked at rover location');
  }
  if(a.type==='return'&&a.key===stateKey(s)){n.returnPlan=a.plan;n.returnPending=false;if(!a.plan.feasible)n.status='No feasible return found';else if(n.status==='No feasible return found')n.status='Caution'}
  if(a.type==='propose'){n.pending=a.plan;n.running=false;record(n,'recommendation',a.plan.explanation)}
  if(a.type==='note')record(n,'note',a.text,{position:n.position,simulated:true});
  return n;
}
export interface Recording {version:1;config:Config;actions:Action[];dataVersion:string}
export function playRecording(recording:Recording):State {
  if(recording.version!==1||!Array.isArray(recording.actions)||recording.actions.length>100000)throw new Error('Unsupported recording');
  let s=initial(recording.config);for(const a of recording.actions){if(a.type==='tick'&&(!Number.isFinite(a.seconds)||a.seconds<0||a.seconds>86400))throw new Error('Invalid replay duration');s=reduce(s,a)}return s;
}
