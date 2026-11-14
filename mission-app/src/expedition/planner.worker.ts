/// <reference lib="webworker" />
import { loadGrids,loadManifest,packUrl } from '../lib/datapack'
import { buildNavGrid } from '../route/build'
import { planExpedition } from './planning'
import type { State,Target } from './types'
const data=Promise.all([loadManifest(),loadGrids()]).then(async([m,g])=>{
  const grid=buildNavGrid(m,g.raw,g.decode,await fetch(packUrl(m.vectors.msl_traverse)).then(r=>r.json()));
  const response=await fetch(packUrl('grids/validity.bin'));
  if(!response.ok)throw new Error('Verified terrain validity mask is unavailable');
  const valid=new Uint8Array(await response.arrayBuffer());if(valid.length!==grid.w*grid.h)throw new Error('Invalid terrain mask size');
  for(let i=0;i<valid.length;i++)if(!valid[i])grid.hazard[i]|=2;
  return grid;
});
self.onmessage=async(e:MessageEvent<{id:number;state:State;targets:Target[];returnOnly?:boolean;walkback?:boolean}>)=>{
  const {id,state,targets,returnOnly,walkback}=e.data;
  try{self.postMessage({id,plans:planExpedition(await data,state,targets,returnOnly,walkback)})}
  catch(error){self.postMessage({id,error:String(error)})}
};
