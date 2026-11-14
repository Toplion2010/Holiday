import {useEffect,useRef} from 'react'
import OlMap from 'ol/Map';import View from 'ol/View';import VectorLayer from 'ol/layer/Vector';import VectorSource from 'ol/source/Vector';import Feature from 'ol/Feature';import Point from 'ol/geom/Point';import LineString from 'ol/geom/LineString';import Circle from 'ol/geom/Circle';import {Style,Stroke,Fill,Text,Circle as Dot} from 'ol/style';import 'ol/ol.css'
import {buildLayer} from '../map/MapView';import {LAYERS} from '../map/layers';import {MARS_EQC} from '../lib/mars-proj'
import type {Package} from './data';import type {State,Target,XY,Plan} from './types'
export const MAP_LAYERS=LAYERS.filter(l=>['ortho','hillshade','elevation','thermal_night','slope','roughness','hazards'].includes(l.id))
export function MissionMap({data,state,targets,layers,opacity,onPick,alternatives}:{data:Package;state:State;targets:Target[];layers:string[];opacity:number;onPick:(xy:XY)=>void;alternatives:Plan[]}){
 const host=useRef<HTMLDivElement>(null),map=useRef<OlMap|null>(null),source=useRef(new VectorSource()),callback=useRef(onPick);callback.current=onPick;
 useEffect(()=>{if(!host.current)return;const [l,b,r,t]=data.manifest.bounds.projected;const raster=MAP_LAYERS.map(def=>buildLayer(def,data.manifest));const vector=new VectorLayer({source:source.current,zIndex:50});const m=new OlMap({target:host.current,layers:[...raster,vector],view:new View({projection:MARS_EQC,center:[(l+r)/2,(b+t)/2],resolution:4,minResolution:0.5,maxResolution:20,extent:[l,b,r,t]})});m.on('singleclick',e=>callback.current(e.coordinate as XY));map.current=m;const observer=new ResizeObserver(()=>m.updateSize());observer.observe(host.current);return()=>{observer.disconnect();m.setTarget(undefined);map.current=null}},[data]);
 useEffect(()=>{map.current?.getLayers().forEach(l=>{const id=l.get('id');if(id){l.setVisible(layers.includes(id));l.setOpacity(id==='ortho'?1:opacity)}})},[layers,opacity,data]);
 useEffect(()=>{const src=source.current;src.clear();const line=(coords:XY[],color:string,width=3,dash?:number[])=>{if(coords.length<2)return;const f=new Feature(new LineString(coords));f.setStyle(new Style({stroke:new Stroke({color,width,lineDash:dash})}));src.addFeature(f)};
 const marker=(xy:XY,label:string,color:string,radius=6)=>{const f=new Feature(new Point(xy));f.setStyle(new Style({image:new Dot({radius,fill:new Fill({color}),stroke:new Stroke({color:'#111b21',width:2})}),text:new Text({text:label,offsetY:-15,font:'bold 11px monospace',fill:new Fill({color:'#fff'}),stroke:new Stroke({color:'#111b21',width:4})})}));src.addFeature(f)};
 for(const p of alternatives.filter(p=>p.feasible&&p.id!==state.plan?.id))for(const leg of p.legs)line(leg.coords,'#b6c3cb70',1,[5,5]);
 if(state.plan)for(const leg of state.plan.legs)line(leg.coords,leg.mode==='rover'?'#ffbd72':'#72e0ca',3);
 if(state.returnPlan)for(const leg of state.returnPlan.legs)line(leg.coords,'#b0a4ff',2,[6,4]);
 line(state.actual,'#fff',2);marker(state.config.base,'BASE','#fff',9);marker(state.rover,'ROVER','#ffbd72',7);
 for(const target of targets){marker(target.xy,(state.completed[target.id]?'✓ ':'')+target.id,state.completed[target.id]?'#9bffb3':'#f7d79e');if(target.xy[0]!==target.observedXY[0]||target.xy[1]!==target.observedXY[1]){line([target.observedXY,target.xy],'#f7d79e',1,[2,3]);marker(target.observedXY,'source','#b7b7b7',3)}}
 for(const xy of state.obstacles){const f=new Feature(new Circle(xy,9));f.setStyle(new Style({fill:new Fill({color:'#fa667477'}),stroke:new Stroke({color:'#ff5572',width:2})}));src.addFeature(f)}
 if(state.faults.confidence){const f=new Feature(new Circle(state.position,100));f.setStyle(new Style({stroke:new Stroke({color:'#ffca78',lineDash:[5,5]}),fill:new Fill({color:'#ffca7815'})}));src.addFeature(f)}
 marker(state.position,'YOU','#72e0ca',8);
 },[state,targets,alternatives]);
 return <div className="map-canvas" ref={host} aria-label="Interactive Mars mission map"/>;
}
