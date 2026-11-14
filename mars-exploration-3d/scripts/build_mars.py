import bpy, math, os
from mathutils import Vector
D=os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(n,c,metal=0,rough=.4):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
white=mat('Ceramic ivory',(.8,.83,.8));dark=mat('Graphite',(.035,.05,.065),.55);metal=mat('Titanium',(.28,.35,.4),.8);orange=mat('Safety orange',(.95,.19,.025));gold=mat('Gold visor',(.65,.35,.07),.85,.15);glass=mat('Optics',(.015,.08,.12),.7,.12);blue=mat('Solar cells',(.025,.07,.19),.65);rubber=mat('Joint fabric',(.075,.09,.11))
root=None
def finish(o,n,m):
 o.name=n;o.data.materials.append(m)
 if root:o.parent=root
 return o
def box(n,p,s,m,b=.025):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if b:
  mod=o.modifiers.new('Manufactured edges','BEVEL');mod.width=b;mod.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return finish(o,n,m)
def ell(n,p,s,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=p);o=bpy.context.object;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for f in o.data.polygons:f.use_smooth=True
 return finish(o,n,m)
def rod(n,a,b,r,m,verts=20):
 a,b=Vector(a),Vector(b);v=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=v.length,location=(a+b)/2);o=bpy.context.object;o.rotation_euler=v.to_track_quat('Z','Y').to_euler();return finish(o,n,m)
def empty(n):
 o=bpy.data.objects.new(n,None);bpy.context.collection.objects.link(o);return o
root=empty('ROVER');rover=root
box('Chassis',(0,0,.96),(1.3,2.15,.46),white,.08);box('Lower frame',(0,0,.69),(1.05,1.9,.15),dark)
box('Science deck',(0,0,1.23),(1.48,2.3,.12),metal)
for x in [-.68,.68]:
 for y in [-.75,0,.75]:
  box('Thermal panel',(x,y,1.01),(.035,.57,.24),orange,.008)
for side in [-1,1]:
 x=side*1.02
 rod('Rocker beam',(side*.58,0,.94),(x,-.94,.48),.065,metal)
 rod('Bogie link',(side*.58,0,.94),(x,.6,.53),.065,metal)
 rod('Bogie beam',(x,0,.4),(x,1.03,.4),.055,metal)
 for y in [-1.03,0,1.03]:
  rod('Wheel axle',(side*.68,y,.37),(x,y,.37),.07,metal)
  rod('Wheel drum',(x-.15,y,.37),(x+.15,y,.37),.35,dark,32)
  rod('Outer rim',(x+side*.151,y,.37),(x+side*.175,y,.37),.27,metal,32)
  rod('Hub',(x+side*.17,y,.37),(x+side*.21,y,.37),.10,orange)
  for i in range(20):
   t=i*math.tau/20;o=box('Wheel tread',(x,y+.351*math.sin(t),.37+.351*math.cos(t)),(.34,.055,.035),metal,.006);o.rotation_euler.x=-t
  for i in range(6):
   t=i*math.tau/6;rod('Wheel spoke',(x+side*.18,y,.37),(x+side*.18,y+.24*math.sin(t),.37+.24*math.cos(t)),.024,dark,8)
rod('Mast',(0,-.65,1.29),(0,-.65,2.02),.065,metal)
box('Camera head',(0,-.65,2.09),(.59,.25,.22),white)
for x in [-.19,.19]:
 rod('Camera housing',(x,-.78,2.1),(x,-.84,2.1),.083,dark);rod('Camera lens',(x,-.841,2.1),(x,-.85,2.1),.061,glass)
for x in [-.43,.43]:
 box('Solar frame',(x,.38,1.33),(.7,1.25,.045),dark,.01)
 for i in range(3):
  for j in range(6):box('Solar cell',(x+(i-1)*.215,.38+(j-2.5)*.195,1.359),(.2,.18,.009),blue,.001)
rod('Antenna',(0,.9,1.3),(0,.9,1.94),.018,metal);ell('Antenna tip',(0,.9,1.95),(.035,.035,.06),orange)
arm=[(.49,-1.1,1.1),(.68,-1.5,1.43),(.62,-1.88,.92),(.62,-2.02,.8)]
for a,b in zip(arm,arm[1:]):rod('Sampling arm',a,b,.055,white);ell('Arm joint',a,(.085,.085,.085),dark)
rod('Drill',arm[-1],(.62,-2.02,.55),.035,metal)
# Astronaut uses an adult 1.85 m silhouette, facing -Y.
root=empty('ASTRONAUT');astro=root
box('Life support pack',(0,.205,1.2),(.43,.24,.52),white,.065)
box('Pack orange inset',(0,.335,1.24),(.29,.025,.3),orange)
ell('Torso',(0,0,1.2),(.245,.155,.31),white);ell('Pelvis',(0,0,.91),(.225,.15,.16),white)
rod('Neck seal',(0,0,1.44),(0,0,1.52),.135,dark)
ell('Helmet shell',(0,0,1.65),(.20,.19,.20),white)
ell('Visor gasket',(0,-.153,1.66),(.166,.062,.145),dark)
ell('Visor',(0,-.19,1.66),(.148,.038,.123),gold)
box('Chest control',(0,-.158,1.25),(.28,.065,.19),white)
box('Chest screen',(-.05,-.197,1.28),(.12,.012,.07),glass,.004)
for x in [.035,.075,.115]:ell('Status button',(x,-.199,1.22),(.013,.008,.013),orange)
for s in [-1,1]:
 x=s*.12
 ell('Thigh',(x,0,.72),(.112,.12,.22),white)
 ell('Knee joint',(x,-.005,.51),(.104,.111,.08),rubber)
 box('Knee pad',(x,-.105,.52),(.14,.045,.12),orange)
 ell('Shin',(x,0,.32),(.098,.108,.18),white)
 box('Boot',(x,-.045,.105),(.21,.33,.19),white,.055)
 box('Boot sole',(x,-.05,.026),(.215,.34,.05),dark,.015)
 shoulder=(s*.25,0,1.37);elbow=(s*.36,0,1.12);wrist=(s*.43,-.025,.94)
 ell('Shoulder',shoulder,(.12,.13,.13),white)
 rod('Upper sleeve',shoulder,elbow,.091,white)
 ell('Elbow bellows',elbow,(.09,.095,.075),rubber)
 rod('Forearm',elbow,wrist,.078,white)
 rod('Wrist seal',wrist,(s*.44,-.03,.905),.08,orange)
 ell('Glove',(s*.45,-.03,.855),(.074,.065,.093),white)
 ell('Thumb',(s*.40,-.075,.88),(.033,.034,.053),white)
# Export each at its own origin, in metres.
for ob,filename in [(rover,'mars_rover.glb'),(astro,'mars_astronaut.glb')]:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True)
 for child in ob.children_recursive:child.select_set(True)
 bpy.ops.export_scene.gltf(filepath=os.path.join(D,filename),use_selection=True,export_format='GLB',export_apply=True)
astro.location=(2.2,-.25,0)
root=None
floor=mat('Studio floor',(.18,.115,.085))
box('Display ground',(0,0,-.08),(200,200,.1),floor,0)
world=bpy.context.scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.17,.21,.28,1);world.node_tree.nodes['Background'].inputs[1].default_value=.5
for n,p,power,size in [('Key',(1,-4,7),1600,5),('Fill',(-4,-1,4),1100,4),('Rim',(2,5,6),1900,4)]:
 bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.name=n;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((.5,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(6,-9,5));cam=bpy.context.object;cam.rotation_euler=(Vector((.6,-.1,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=6.4
sc=bpy.context.scene;sc.camera=cam;sc.unit_settings.system='METRIC';sc.render.engine='CYCLES';sc.cycles.samples=24;sc.cycles.use_denoising=False;sc.render.resolution_x=1200;sc.render.resolution_y=900;sc.render.resolution_percentage=100
# Comfortable initial viewport.
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_distance=7;area.spaces.active.region_3d.view_location=(.5,0,1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D,'mars_exploration.blend'))
sc.render.filepath=os.path.join(D,'preview.png');bpy.ops.render.render(write_still=True)
print('DONE',len(bpy.data.objects))
