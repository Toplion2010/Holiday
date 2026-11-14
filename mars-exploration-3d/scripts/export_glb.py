import bpy, os, traceback
D = r"C:\Users\seymu\Desktop\Mars_Exploration_3D"
root = bpy.data.objects.get("ROVER") or bpy.data.objects.get("ASTRONAUT")
stem = "mars_rover" if root.name == "ROVER" else "mars_astronaut"
log = []
try:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(True)
    win = bpy.context.window_manager.windows[0]
    sc = bpy.data.scenes[0]
    with bpy.context.temp_override(window=win, scene=sc, view_layer=sc.view_layers[0], active_object=root, object=root):
      bpy.ops.export_scene.gltf(filepath=os.path.join(D, stem + "_animated.glb"), use_selection=True,
                              export_format="GLB", export_apply=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS")
    log.append("OK")
except Exception:
    log.append(traceback.format_exc())
for o in [root] + list(root.children_recursive):
    ad = o.animation_data
    if ad and ad.nla_tracks:
        log.append(o.name + ": " + ", ".join(f"{t.name}[{s.frame_start}-{s.frame_end}] slot={getattr(s,'action_slot',None)}" for t in ad.nla_tracks for s in t.strips))
open(os.path.join(D, "export_log.txt"), "w").write("\n".join(log))
