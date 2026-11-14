import { prepare,astar,cellOf,centerOf,lineCells,timeField,type NavGrid,type Prepared } from '../route/grid'
import { speedFor,PROFILE_PARAMS } from '../route/model'
import { rates,speedFactor,scienceValue,stateKey,validateConfig } from './model'
import type { State,Target,Plan,Objective,Leg,Mode,XY,Work } from './types'

export function applyObstacles(original:NavGrid,s:State):NavGrid {
  const g={...original,hazard:original.hazard.slice()};
  for(const point of s.obstacles){const c=cellOf(g,...point);if(c<0)continue;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const row=Math.floor(c/g.w)+dy,col=c%g.w+dx;if(row>=0&&row<g.h&&col>=0&&col<g.w)g.hazard[row*g.w+col]|=2;
  }}return g;
}
export function routeLeg(g:NavGrid,s:State,from:string,to:string,a:XY,b:XY,mode:Mode,objective:Objective,p?:Prepared):Leg|null {
  p??=prepare(g,mode==='walk'?PROFILE_PARAMS.solo:PROFILE_PARAMS.rover,objective==='risk'||objective==='balanced'?'safest':'fastest');
  const start=cellOf(g,...a),goal=cellOf(g,...b);
  const result=astar(p,start,goal);if(!result)return null;
  const coords=result.cells.map(c=>centerOf(g,c));const elevations=result.cells.map(c=>g.elev[c]);
  // Exact input positions are retained within their validated cells, including mid-edge replans.
  coords[0]=[...a];if(coords.length===1){coords.push([...b]);elevations.push(elevations[0])}else coords[coords.length-1]=[...b];
  const stepSeconds:number[]=[];let distance=0,seconds=0,risk=0,oxygen=0,suitWh=0,roverWh=0;
  for(let i=1;i<coords.length;i++){
    const cell=result.cells[Math.min(i,result.cells.length-1)];const d=Math.hypot((coords[i][0]-coords[i-1][0])*g.cellX/g.res,coords[i][1]-coords[i-1][1]);
    const grade=d>0?(elevations[i]-elevations[i-1])/d:0;
    const dt=d/(speedFor(mode)(grade)*speedFactor(s,mode))*p.mulTime[cell];const r=rates(s,mode,grade);
    stepSeconds.push(dt);seconds+=dt;distance+=d;risk+=d*(g.slope[cell]/25+g.rock[cell]+g.rough[cell]);oxygen+=dt*r.oxygen;suitWh+=dt*r.suitWh;roverWh+=dt*r.roverWh;
  }
  return {from,to,cells:result.cells,coords,elevations,seconds,distance,risk,mode,stepSeconds,oxygen,suitWh,roverWh};
}
export function evaluate(s:State,legs:Leg[],work:Work[],id:Objective,targets:Target[],extra:string[]=[]):Plan {
  const seconds=legs.reduce((v,l)=>v+l.seconds,0)+work.reduce((v,w)=>v+w.seconds,0);
  const idle=work.reduce((v,w)=>v+w.seconds,0),r=rates(s,'work');
  const oxygen=legs.reduce((v,l)=>v+l.oxygen,0)+idle*r.oxygen,suitWh=legs.reduce((v,l)=>v+l.suitWh,0)+idle*r.suitWh,roverWh=legs.reduce((v,l)=>v+l.roverWh,0);
  const margins={oxygen:s.oxygen-oxygen-s.config.oxygen*s.config.reserve,suitWh:s.suitWh-suitWh-s.config.suitWh*s.config.reserve,
    roverWh:s.roverWh-roverWh-(legs.some(l=>l.mode==='rover')?s.config.roverWh*s.config.reserve:0),time:s.config.duration-s.elapsed-seconds};
  const reasons=[...extra];for(const [k,v]of Object.entries(margins))if(v<-1e-8)reasons.push(k+' would fall below the configured return reserve');
  const visited=work.map(w=>w.target);return {id,legs,work,targets:visited,seconds,travelSeconds:seconds-idle,distance:legs.reduce((v,l)=>v+l.distance,0),
    oxygen,suitWh,roverWh,value:work.reduce((v,w)=>v+w.value,0),feasible:!reasons.length,reasons,margins,
    explanation:'Final route and activities evaluated against separate oxygen, suit energy, rover energy and time constraints.',revision:s.revision,
    skipped:targets.filter(t=>t.selected!=='skip'&&!s.completed[t.id]&&!visited.includes(t.id)).map(t=>t.id),start:[...s.position],stateKey:stateKey(s),roverDependencies:[]};
}
export function makePlanner(g:NavGrid,s:State,objective:Objective) {
  const profiles=new Map<Mode,Prepared>(),cache=new Map<string,Leg|null>();
  const prep=(mode:Mode)=>{let p=profiles.get(mode);if(!p){p=prepare(g,mode==='walk'?PROFILE_PARAMS.solo:PROFILE_PARAMS.rover,objective==='risk'||objective==='balanced'?'safest':'fastest');
    if(objective==='shortest'){p.speed=()=>1;p.vmax=1;p.mulCost.fill(1);p.minMul=1}
    profiles.set(mode,p)}return p};
  const leg=(from:string,to:string,a:XY,b:XY,mode:Mode)=>{const key=JSON.stringify([a,b,mode]);if(!cache.has(key))cache.set(key,routeLeg(g,s,from,to,a,b,mode,objective,prep(mode)));const l=cache.get(key);return l?{...l,from,to}:null};
  const parking=(point:XY):XY|null=>{const p=prep('rover'),c=cellOf(g,...point);if(c<0)return null;if(!p.blocked[c])return point;
    // Parking is an explicit route node; never substitute it for the science location.
    for(let r=1;r<=40;r+=2){for(let dx=-r;dx<=r;dx+=2)for(const dy of [-r,r]){const x=c%g.w+dx,y=Math.floor(c/g.w)+dy;if(x<0||y<0||x>=g.w||y>=g.h)continue;const i=y*g.w+x;if(p.blocked[i])continue;const candidate=centerOf(g,i);if(leg('parking','target',candidate,point,'walk'))return candidate}}
    return null};
  return {leg,parking,prep};
}
export function planExpedition(original:NavGrid,s:State,targets:Target[],returnOnly=false,forceWalk=false):Plan[] {
  const g=applyObstacles(original,s),inputErrors=validateConfig(s.config);
  if(targets.length>5)inputErrors.push('At most five curated science stations are supported per expedition');
  const requested=targets.filter(t=>t.selected!=='skip'&&!s.completed[t.id]);
  const objectives:Objective[]=returnOnly?['fastest']:['shortest','fastest','risk','science','balanced'];
  return objectives.map(objective=>{
    const planner=makePlanner(g,s,objective);
    const mode:Mode=!forceWalk&&s.config.mode==='rover'&&!s.faults.failure?'rover':'walk';
    const errors=[...inputErrors];const walkStart=cellOf(g,...s.position),baseCell=cellOf(g,...s.config.base);
    if(walkStart<0||baseCell<0)errors.push('Position or base is outside valid terrain coverage');
    if(returnOnly){const driving=mode==='rover'&&s.aboard;const back=planner.leg('current','base',s.position,s.config.base,driving?'rover':'walk');
      return evaluate(s,back?[back]:[],[],objective,[],back?errors:[...errors,'No traversable return route found']);}
    if(!requested.length)errors.push('Choose at least one scientific activity');
    const modeStart:Leg[]=[];let start=s.position;
    if(mode==='rover'&&!s.aboard){const join=planner.leg('current','rover',s.position,s.rover,'walk');if(!join)errors.push('Cannot reach the rover on foot');else {modeStart.push(join);start=s.rover}}
    const park=new Map<string,XY|null>();for(const t of requested)park.set(t.id,mode==='rover'?planner.parking(t.xy):t.xy);
    const required=requested.filter(t=>t.required).map(t=>t.id);
    let best:Plan|null=null,failed:Plan|null=null,bestScore=-Infinity;
    // Five stations: at most 325 non-empty ordered subsets. Geometry is cached independently of order.
    const visit=(order:Target[],remaining:Target[])=>{
      if(order.length&&required.every(id=>order.some(t=>t.id===id))){
        const legs=[...modeStart],work:Work[]=[],reasons=[...errors];let at=start,from='current';const themes={...s.completedThemes};
        for(const t of order){const destination=park.get(t.id);if(!destination){reasons.push('No accessible parking within 80 m of '+t.name);break}
          const travel=planner.leg(from,t.id,at,destination,mode);if(!travel){reasons.push('No traversable '+mode+' path to '+t.name);break}
          const needsWalk=mode==='rover'&&(destination[0]!==t.xy[0]||destination[1]!==t.xy[1]);
          if(needsWalk){travel.to=t.id+' parking';legs.push(travel);const out=planner.leg(t.id+' parking',t.id,destination,t.xy,'walk'),back=planner.leg(t.id,t.id+' parking',t.xy,destination,'walk');if(!out||!back){reasons.push('Walking excursion unavailable');break}legs.push(out,back)}else legs.push(travel);
          const activity=t.activities.find(a=>a.id===t.selected);if(!activity){reasons.push('Select a valid activity for '+t.name);break}
          if(!s.config.tools.includes(activity.tool))reasons.push('Missing '+activity.tool+' for '+t.name);
          work.push({target:t.id,activity:activity.id,name:activity.name,seconds:activity.seconds*(s.faults.delay?2:1),value:scienceValue(t,activity,s.config.objective,themes),tool:activity.tool,theme:t.theme});
          themes[t.theme]=(themes[t.theme]??0)+1;at=destination;from=t.id;
        }
        const back=planner.leg(from,'base',at,s.config.base,mode);if(back)legs.push(back);else reasons.push('No traversable path back to base');
        const candidate=evaluate(s,legs,work,objective,requested,reasons);
        if(!failed||candidate.reasons.length<failed.reasons.length)failed=candidate;
        if(candidate.feasible){const risk=legs.reduce((v,l)=>v+l.risk,0);const score=objective==='science'?candidate.value*1e6-candidate.seconds:objective==='shortest'?-candidate.distance:objective==='fastest'?-candidate.seconds:objective==='risk'?-risk:candidate.value*100-candidate.seconds/5-risk/10;
          if(score>bestScore){best=candidate;bestScore=score}}
      }
      for(let i=0;i<remaining.length;i++)visit([...order,remaining[i]],remaining.filter((_,j)=>j!==i));
    };
    if(!errors.length)visit([],requested);
    const result:Plan=best??failed??evaluate(s,[],[],objective,requested,errors.length?errors:['No feasible expedition found']);
    result.explanation=(objective==='balanced'?'Recommended compromise: science ×100 − seconds ÷5 − integrated terrain risk ÷10.':objective==='science'?'Highest feasible activity value, then shorter duration.':objective==='shortest'?'Lowest ground distance among feasible visits.':objective==='fastest'?'Lowest travel + activity duration among feasible visits.':'Lowest integrated slope, roughness and rock-proxy score among feasible visits.')+' '+result.explanation+(result.skipped.length?' Optional stations omitted: '+result.skipped.join(', ')+'.':'');
    if(result.feasible&&mode==='rover'){
      const walking=makePlanner(g,s,'fastest'),p=walking.prep('walk');const speed=p.speed;p.speed=(grade)=>speed(grade)*speedFactor(s,'walk');
      const parent=new Int32Array(g.w*g.h).fill(-1),base=cellOf(g,...s.config.base);
      const backTime=timeField(p,base,true,s.config.duration-s.elapsed,parent);
      const oxygenField=new Float64Array(g.w*g.h).fill(NaN);oxygenField[base]=0;
      const backOxygen=(cell:number)=>{if(!Number.isFinite(backTime[cell]))return Infinity;const chain:number[]=[];let at=cell;while(at>=0&&Number.isNaN(oxygenField[at])){chain.push(at);at=parent[at]}if(at<0)return Infinity;
        for(let i=chain.length-1;i>=0;i--){const v=chain[i],u=parent[v];const d=Math.hypot(((u%g.w)-(v%g.w))*g.cellX,(Math.floor(u/g.w)-Math.floor(v/g.w))*g.cellY);const grade=(g.elev[u]-g.elev[v])/d;const dt=d/p.speed(grade)*p.mulTime[u];oxygenField[v]=oxygenField[u]+dt*rates(s,'walk',grade).oxygen}return oxygenField[cell]};
      let usedO2=0,usedSuit=0,elapsed=0;
      for(const l of result.legs){
        for(let i=0;i<l.coords.length;i++){
          if(i>0){const a=l.coords[i-1],b=l.coords[i],d=Math.hypot((b[0]-a[0])*g.cellX/g.res,b[1]-a[1]),grade=d>0?(l.elevations[i]-l.elevations[i-1])/d:0,dt=l.stepSeconds[i-1],r=rates(s,l.mode,grade);usedO2+=dt*r.oxygen;usedSuit+=dt*r.suitWh;elapsed+=dt}
          const point=l.coords[i],cell=cellOf(g,...point);const oxygenMargin=s.oxygen-usedO2-backOxygen(cell)-s.config.oxygen*s.config.reserve,suitMargin=s.suitWh-usedSuit-backTime[cell]*s.config.suitW/3600-s.config.suitWh*s.config.reserve;
          result.roverDependencies.push({xy:point,feasible:oxygenMargin>=0&&suitMargin>=0&&elapsed+backTime[cell]<=s.config.duration-s.elapsed,oxygenMargin,suitMargin});
        }
        const w=result.work.find(w=>w.target===l.to);if(w){const r=rates(s,'work');usedO2+=w.seconds*r.oxygen;usedSuit+=w.seconds*r.suitWh;elapsed+=w.seconds;
          const point=l.coords[l.coords.length-1],cell=cellOf(g,...point),oxygenMargin=s.oxygen-usedO2-backOxygen(cell)-s.config.oxygen*s.config.reserve,suitMargin=s.suitWh-usedSuit-backTime[cell]*s.config.suitW/3600-s.config.suitWh*s.config.reserve;
          result.roverDependencies.push({xy:point,feasible:oxygenMargin>=0&&suitMargin>=0&&elapsed+backTime[cell]<=s.config.duration-s.elapsed,oxygenMargin,suitMargin});}
      }
    }
    return result;
  });
}
export function canMove(g:NavGrid,s:State,to:XY):boolean {const p=prepare(applyObstacles(g,s),s.aboard?PROFILE_PARAMS.rover:PROFILE_PARAMS.solo,'fastest');const a=cellOf(g,...s.position),b=cellOf(g,...to);return a>=0&&b>=0&&lineCells(p,a,b)!==null}
