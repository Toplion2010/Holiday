import type { Config, State, Plan, Fault, XY } from './types'
import { rates,stateKey } from './model'
export { DEFAULT_CONFIG } from './model'
export function initial(config: Config): State {
  return {config:structuredClone(config),position:[...config.base],rover:[...config.base],aboard:config.mode==='rover',
    elapsed:0,oxygen:config.oxygen,suitWh:config.suitWh,roverWh:config.roverWh,running:false,speed:60,status:'Normal',
    plan:null,leg:0,step:0,segmentElapsed:0,activityElapsed:0,completed:{},completedThemes:{},science:0,
    actual:[[...config.base]],log:[],faults:{},revision:0,obstacles:[],pending:null,returnPlan:null,returnPending:true,assisted:true,heading:0};
}
export function record(s:State,kind:string,text:string,data?:unknown) {s.log.push({at:s.elapsed,kind,text,data})}
export function accept(state:State,p:Plan,emergency=false):State {
  const s=structuredClone(state);
  if(!p.feasible||p.revision!==s.revision||p.stateKey!==stateKey(s)){record(s,'rejected','Plan is infeasible or state changed. Recalculate before approval.');return s}
  if(!emergency&&['Abort','Emergency','No feasible return found'].includes(s.status)&&p.work.length){record(s,'rejected','Optional science is stopped during abort or emergency');return s}
  s.plan=p;s.pending=null;s.leg=0;s.step=0;s.segmentElapsed=0;s.activityElapsed=0;s.assisted=true;
  record(s,'plan','Approved '+p.id+' plan',p);return s;
}
export function consume(s:State,dt:number,mode:'walk'|'rover'|'work',grade=0) {
  const r=rates(s,mode,grade);s.oxygen-=dt*r.oxygen;s.suitWh-=dt*r.suitWh;s.roverWh-=dt*r.roverWh;s.elapsed+=dt;
}
function limitTime(s:State,dt:number,mode:'walk'|'rover'|'work',grade=0) {
  const r=rates(s,mode,grade);
  return Math.max(0,Math.min(dt,s.oxygen/r.oxygen,s.suitWh/r.suitWh,mode==='rover'?s.roverWh/r.roverWh:Infinity,s.config.duration-s.elapsed));
}
export function tick(state:State,seconds:number):State {
  if(!state.running||seconds<=0||!Number.isFinite(seconds))return state;
  const s=structuredClone(state);let left=seconds;
  while(left>1e-7&&s.running){
    if(s.oxygen<1e-10||s.suitWh<1e-8||s.elapsed>=s.config.duration-1e-7||(s.aboard&&s.roverWh<1e-8)){
      s.status='Emergency';s.running=false;record(s,'emergency','Configured equipment or time limit reached');break;
    }
    const leg=s.assisted?s.plan?.legs[s.leg]:undefined;
    if(!leg){const dt=limitTime(s,left,'work');consume(s,dt,'work');left-=dt;continue}
    // Transport transitions happen only at the physical rover position.
    if((leg.mode==='rover')!==s.aboard){
      if(leg.mode==='rover'&&(s.faults.failure||Math.hypot(s.position[0]-s.rover[0],s.position[1]-s.rover[1])>3)){
        s.running=false;s.status='Abort';record(s,'error','Cannot board: rover is unavailable at this location');break;
      }
      s.aboard=leg.mode==='rover';record(s,'transport',s.aboard?'Boarded unpressurized rover':'Disembarked rover');
    }
    if(s.step<leg.coords.length-1){
      const a=leg.coords[s.step],b=leg.coords[s.step+1],d=Math.hypot((b[0]-a[0])*0.996484091,b[1]-a[1]);
      const grade=d>0?(leg.elevations[s.step+1]-leg.elevations[s.step])/d:0;
      const time=leg.stepSeconds[s.step];const dt=limitTime(s,Math.min(left,time-s.segmentElapsed),leg.mode,grade);
      consume(s,dt,leg.mode,grade);left-=dt;s.segmentElapsed+=dt;const t=time>0?s.segmentElapsed/time:1;
      s.position=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];s.heading=(Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI+360)%360;
      if(s.aboard)s.rover=[...s.position];
      if(s.segmentElapsed>=time-1e-7){s.step++;s.segmentElapsed=0;s.actual.push([...s.position])}
    }else{
      const work=s.plan!.work.find(w=>w.target===leg.to);
      if(work&&!s.completed[work.target]&&!['Abort','Emergency','No feasible return found'].includes(s.status)){
        const dt=limitTime(s,Math.min(left,work.seconds-s.activityElapsed),'work');consume(s,dt,'work');left-=dt;s.activityElapsed+=dt;
        if(s.activityElapsed>=work.seconds-1e-7){s.completed[work.target]=work.activity;s.science+=work.value;s.completedThemes[work.theme]=(s.completedThemes[work.theme]??0)+1;
          record(s,'science','Completed simulated '+work.name+' at '+work.target,{...work,simulated:true});s.activityElapsed=0;s.leg++;s.step=0;}
      }else{s.leg++;s.step=0;s.activityElapsed=0}
      if(s.leg>=s.plan!.legs.length){s.running=false;if(Math.hypot(s.position[0]-s.config.base[0],s.position[1]-s.config.base[1])<3){s.status='Completed';record(s,'completed','Returned to base')}}
    }
  }
  return s;
}
export function inject(state:State,fault:Fault,obstacle?:XY):State {
  const s=structuredClone(state);s.faults[fault]=true;record(s,'fault',fault,{fault,obstacle});s.returnPending=true;s.returnPlan=null;s.pending=null;
  if(fault==='obstacle'){const leg=s.plan?.legs[s.leg];const point=obstacle??leg?.coords[Math.min(s.step+12,leg.coords.length-1)];if(point){s.obstacles.push(point);s.revision++}}
  if(fault==='battery')s.roverWh*=0.35;
  if(fault==='failure')s.aboard=false;
  if(['slow','delay','obstacle','leak','wheel','failure','battery','suit','unresponsive'].includes(fault)){s.running=false;s.plan=null;s.activityElapsed=0}
  s.status=fault==='unresponsive'||fault==='suit'?'Emergency':fault==='failure'?'Abort':'Caution';return s;
}
export function manualMove(state:State,to:XY,seconds:number,grade:number):State {
  if(!state.running||state.faults.unresponsive)return state;
  const s=structuredClone(state),mode=s.aboard?'rover':'walk';const dt=limitTime(s,seconds,mode,grade);
  if(dt<seconds)return {...s,running:false,status:'Emergency'};
  consume(s,seconds,mode,grade);s.position=[...to];if(s.aboard)s.rover=[...to];s.actual.push([...to]);s.assisted=false;s.plan=null;s.returnPending=true;return s;
}
