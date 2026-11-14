import {useEffect,useRef,useState} from 'react'
import * as THREE from 'three'
import {makeFrame,eqcToLocal} from './geo'
import {sampleAt,packUrl} from '../lib/datapack'
import {marsTime,sunPosition} from './mars24'
import type {Package} from './data'
import type {State,Target} from './types'
export function Terrain({data,state,targets,onHeading}:{data:Package;state:State;targets:Target[];onHeading:(degrees:number)=>void}){
 const host=useRef<HTMLDivElement>(null),live=useRef(state),heading=useRef(state.heading),[error,setError]=useState('');live.current=state;
 useEffect(()=>{if(!host.current)return;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true})}catch{setError('WebGL is unavailable. The overhead map and mission controls remain usable.');return}
 const el=host.current;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));el.appendChild(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#b28b75');scene.fog=new THREE.Fog('#b28b75',500,2500);
 const camera=new THREE.PerspectiveCamera(70,1,0.2,5000);const frame=makeFrame(data.manifest.bounds.projected,2,data.grids.width,data.grids.height);
 const [left,bottom,right,top]=data.manifest.bounds.projected;const width=(right-left)*frame.kx,height=top-bottom;const n=320;
 const geo=new THREE.PlaneGeometry(width,height,n,n);geo.rotateX(-Math.PI/2);const vertices=geo.attributes.position;const base=data.manifest.elevation_range_m[0];
 for(let i=0;i<vertices.count;i++){const x=frame.cx+vertices.getX(i)/frame.kx,y=frame.cy-vertices.getZ(i);vertices.setY(i,(sampleAt(data.grids,x,y)?.elevation??base)-base)}geo.computeVertexNormals();
 const texture=new THREE.TextureLoader().load(packUrl('terrain/texture.jpg'));texture.colorSpace=THREE.SRGBColorSpace;
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:1,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geo,material));
 const sun=new THREE.DirectionalLight('#ffe4c7',2);scene.add(sun,new THREE.HemisphereLight('#efd7bc','#62422c',2));
 const markers=new THREE.Group();scene.add(markers);for(const t of targets){const pos=eqcToLocal(frame,...t.xy),h=(sampleAt(data.grids,...t.xy)?.elevation??base)-base;const marker=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,5,8),new THREE.MeshBasicMaterial({color:'#77ead1'}));marker.position.set(pos.x,h+2.5,pos.z);markers.add(marker)}
 let drag=false,lastX=0,pitch=0,raf=0;const down=(e:PointerEvent)=>{drag=true;lastX=e.clientX};const up=()=>{drag=false};const move=(e:PointerEvent)=>{if(!drag)return;heading.current+=(e.clientX-lastX)*0.3;pitch=Math.max(-60,Math.min(60,pitch+e.movementY*0.2));lastX=e.clientX;onHeading(heading.current)};
 el.addEventListener('pointerdown',down);window.addEventListener('pointerup',up);el.addEventListener('pointermove',move);
 const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/Math.max(1,el.clientHeight);camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(el);resize();
 const render=()=>{const s=live.current;const pos=eqcToLocal(frame,...s.position);const elevation=(sampleAt(data.grids,...s.position)?.elevation??base)-base;camera.position.set(pos.x,elevation+(s.aboard?2.2:1.7),pos.z);if(s.assisted&&s.running)heading.current=s.heading;const yaw=heading.current*Math.PI/180;camera.lookAt(pos.x+Math.sin(yaw)*30,camera.position.y-Math.tan(pitch*Math.PI/180)*30,pos.z-Math.cos(yaw)*30);
 const solar=sunPosition(marsTime(Date.parse(s.config.departure+'Z')+s.elapsed*1000),s.position[1]/59274.6975,s.position[0]/59274.6975);const az=solar.azimuthDeg*Math.PI/180,alt=solar.elevationDeg*Math.PI/180;sun.position.set(Math.sin(az)*Math.cos(alt)*1000,Math.sin(alt)*1000,-Math.cos(az)*Math.cos(alt)*1000);sun.intensity=solar.elevationDeg>0?2:0;renderer.render(scene,camera);raf=requestAnimationFrame(render)};render();
 return()=>{cancelAnimationFrame(raf);observer.disconnect();el.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);el.removeEventListener('pointermove',move);geo.dispose();material.dispose();texture.dispose();markers.children.forEach(o=>{const m=o as THREE.Mesh;m.geometry.dispose();(m.material as THREE.Material).dispose()});renderer.dispose();renderer.domElement.remove()};
 },[data,targets,onHeading]);
 return <div className="terrain-canvas" ref={host}>{error&&<p className="error">{error}</p>}<span className="terrain-note">Drag to look · WASD / arrows to move · real DEM, modeled lighting · terrain shadows not calculated</span></div>;
}
