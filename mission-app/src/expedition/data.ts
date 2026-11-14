import { loadManifest,loadGrids,packUrl,sampleAt,type Grids,type SiteManifest } from '../lib/datapack'
import { METERS_PER_DEG } from '../lib/site'
import { ACTIVITIES } from './model'
import type { Target,XY,State } from './types'
export interface Package { manifest:SiteManifest; grids:Grids; valid:Uint8Array; targets:Target[]; provenance:Record<string,unknown>;maskVerified:boolean }
export async function loadPackage():Promise<Package> {
  const [manifest,grids,validResponse,targetResponse,sourceResponse]=await Promise.all([loadManifest(),loadGrids(),fetch(packUrl('grids/validity.bin')),fetch(packUrl('candidate-science-targets.geojson')),fetch(packUrl('gale-data-manifest.json'))]);
  if(!targetResponse.ok||!sourceResponse.ok)throw new Error('Verified data package is incomplete; missing validity or provenance file');
  const bytes=validResponse.ok?new Uint8Array(await validResponse.arrayBuffer()):new Uint8Array();const maskVerified=bytes.length===grids.width*grids.height;const valid=maskVerified?bytes:new Uint8Array(grids.width*grids.height);
  const targets=(await targetResponse.json()).features.map((f:{geometry:{coordinates:number[]};properties:Record<string,unknown>},i:number)=>{
    const p=f.properties;const xy:XY=[f.geometry.coordinates[0]*METERS_PER_DEG,f.geometry.coordinates[1]*METERS_PER_DEG];return {id:p.id,name:String(p.name).replace(' observation station','').replace(' campaign station',''),xy,observedXY:[...xy],purpose:p.purpose,source:p.evidence_url,uncertainty:p.display_uncertainty_m,activities:structuredClone(ACTIVITIES),selected:i<2?'survey':'skip',required:i===0,theme:i===0?'stratigraphy':i===4?'geomorphology':'groundwater',date:p.observation_date,sol:p.observation_sol,locationNote:p.coordinate_role} as Target;
  });return{manifest,grids,valid,targets,maskVerified,provenance:await sourceResponse.json()};
}
export function indexAt(p:Package,xy:XY){const g=p.grids;const col=Math.floor((xy[0]-g.left)/g.res),row=Math.floor((g.top-xy[1])/g.res);return col<0||row<0||col>=g.width||row>=g.height?-1:row*g.width+col}
export function clearCell(p:Package,xy:XY,mode:'walk'|'rover',obstacles:XY[]=[]){const i=indexAt(p,xy);if(i<0||!p.valid[i])return false;const h=p.grids.raw.hazard[i],s=p.grids.decode.slope(p.grids.raw.slope[i]);return Number.isFinite(s)&&s<=(mode==='walk'?20:15)&&!(h&(2|16))&&!(mode==='rover'&&(h&8))&&!obstacles.some(o=>Math.abs(o[0]-xy[0])<=7&&Math.abs(o[1]-xy[1])<=7)}
export function proposeStandOff(p:Package,xy:XY):XY|null {const g=p.grids;for(let r=0;r<20;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;const point:XY=[g.left+(Math.floor((xy[0]-g.left)/g.res)+dx+0.5)*g.res,g.top-(Math.floor((g.top-xy[1])/g.res)+dy+0.5)*g.res];if(clearCell(p,point,'walk'))return point}return null}
export function movement(p:Package,s:State,dx:number,dy:number):{to:XY;grade:number}|null {
  const to:XY=[s.position[0]+dx,s.position[1]+dy],mode=s.aboard?'rover':'walk';const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/p.grids.res*2));
  let previous=s.position;for(let i=1;i<=steps;i++){const point:XY=[s.position[0]+dx*i/steps,s.position[1]+dy*i/steps];if(!clearCell(p,point,mode,s.obstacles)||!clearCell(p,[point[0],previous[1]],mode,s.obstacles)||!clearCell(p,[previous[0],point[1]],mode,s.obstacles))return null;previous=point}
  const a=sampleAt(p.grids,...s.position),b=sampleAt(p.grids,...to);if(!a||!b)return null;return{to,grade:(b.elevation-a.elevation)/Math.max(0.01,Math.hypot(dx*0.996484091,dy))};
}
