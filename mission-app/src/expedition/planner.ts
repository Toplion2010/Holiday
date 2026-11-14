import type { State,Target,Plan } from './types'
const worker=new Worker(new URL('./planner.worker.ts',import.meta.url),{type:'module'});let seq=0;
const pending=new Map<number,{resolve:(p:Plan[])=>void;reject:(e:Error)=>void}>();worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);if(e.data.error)p.reject(new Error(e.data.error));else p.resolve(e.data.plans)}
export function plan(state:State,targets:Target[],returnOnly=false,walkback=false):Promise<Plan[]>{const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,state,targets,returnOnly,walkback})})}
