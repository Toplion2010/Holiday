# Run on mars_exploration.blend (unanimated). Set KIND = "astronaut" or "rover" before exec.
import bpy, math, os
from mathutils import Matrix, Vector

D = r"C:\Users\seymu\Desktop\Mars_Exploration_3D"
sc = bpy.context.scene
SPEED = 1.45 / 36
CYCLE = 36
WHEEL_R = 0.37


def base(n):
    return n.split(".")[0]


def pivot(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    sc.collection.objects.link(e)
    e.empty_display_type = "SPHERE"
    e.empty_display_size = 0.05
    e.parent = parent
    e.location = loc
    bpy.context.view_layer.update()
    return e


def reparent(obj, new_parent):
    mw = obj.matrix_world.copy()
    obj.parent = new_parent
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = mw


def smooth(t):
    return t * t * (3 - 2 * t)


def path(frames, turn, ramp=0):
    # heading turns by `turn` radians between ramp and frames-ramp; returns [(x, y, yaw)]
    out = []
    x = y = yaw = 0.0
    arc = max(1, frames - 2 * ramp)
    for i in range(frames):
        if i:
            x += SPEED * math.sin(yaw)
            y -= SPEED * math.cos(yaw)
        t = min(1.0, max(0.0, (i - ramp) / arc))
        yaw = turn * (t if ramp else smooth(t))
        out.append((x, y, yaw))
    return out


def bake(clips, start_gap=0):
    # clips: [(clip_name, frames, {obj: fn(i)->[(data_path, value_tuple)]})]
    start = 1
    for clip, frames, objs in clips:
        for obj, fn in objs.items():
            ad = obj.animation_data_create()
            act = bpy.data.actions.new(f"{clip}_{obj.name}")
            ad.action = act
            for i in range(frames):
                for path_, val in fn(i):
                    setattr(obj, path_, val)
                    obj.keyframe_insert(path_, frame=1 + i)
            tr = ad.nla_tracks.new()
            tr.name = clip
            st = tr.strips.new(clip, start, act)
            if hasattr(st, "action_slot") and len(getattr(act, "slots", [])):
                st.action_slot = act.slots[0]
            st.extrapolation = "NOTHING"
            ad.action = None
        start += frames
    return start - 1


def setup_view(root, end):
    sc.frame_start = 1
    sc.frame_end = end
    cam = bpy.data.objects.get("Camera")
    if cam:
        cam.location = (9, -12, 9)
        cam.data.ortho_scale = 11
        c = cam.constraints.new("TRACK_TO")
        c.target = root
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"
    sc.frame_set(1)


def astronaut():
    bpy.data.objects.remove(bpy.data.objects["ROVER"], do_unlink=True)
    for o in list(bpy.data.objects):
        if o.parent is None and o.type == "MESH" and o.name != "Display ground":
            bpy.data.objects.remove(o, do_unlink=True)
    root = bpy.data.objects["ASTRONAUT"]
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    LEG = ("Thigh", "Knee joint", "Knee pad")
    LOWER = ("Shin", "Boot", "Boot sole")
    ARM = ("Shoulder", "Upper sleeve", "Elbow bellows", "Forearm", "Wrist seal", "Glove", "Thumb")
    parts = list(root.children)
    rig = {}
    for s, tag in ((-1, "R"), (1, "L")):
        hip = pivot(f"HIP_{tag}", root, (s * 0.12, 0, 0.86))
        sh = pivot(f"SHOULDER_{tag}", root, (s * 0.25, 0, 1.37))
        knee = pivot(f"KNEE_{tag}", hip, (0, 0, -0.35))
        for o in parts:
            if s * o.location.x <= 0:
                continue
            b = base(o.name)
            if b in LOWER:
                reparent(o, knee)
            elif b in LEG:
                reparent(o, hip)
            elif b in ARM:
                reparent(o, sh)
        rig[tag] = (hip, knee, sh, 0.0 if tag == "L" else math.pi)

    def limbs(frames):
        d = {}
        for tag, (hip, knee, sh, ph) in rig.items():
            def mk(kind, ph=ph):
                def f(i):
                    p = 2 * math.pi * i / CYCLE + ph
                    a = {"hip": -math.radians(25) * math.sin(p),
                         "knee": math.radians(45) * max(0.0, math.cos(p)),
                         "sh": math.radians(20) * math.sin(p)}[kind]
                    return [("rotation_euler", (a, 0, 0))]
                return f
            d[hip] = mk("hip")
            d[knee] = mk("knee")
            d[sh] = mk("sh")
        return d

    def root_fn(pts):
        def f(i):
            x, y, yaw = pts[i]
            p = 2 * math.pi * i / CYCLE
            return [("location", (x, y, 0.025 * math.cos(2 * p))), ("rotation_euler", (0, 0, yaw))]
        return f

    F = CYCLE * 2 + 1
    T = CYCLE * 3 + 1
    clips = [("Walk", F, {root: root_fn(path(F, 0)), **limbs(F)}),
             ("WalkLeft", T, {root: root_fn(path(T, math.pi / 2)), **limbs(T)}),
             ("WalkRight", T, {root: root_fn(path(T, -math.pi / 2)), **limbs(T)})]
    return root, bake(clips), "mars_astronaut"


def rover():
    bpy.data.objects.remove(bpy.data.objects["ASTRONAUT"], do_unlink=True)
    for o in list(bpy.data.objects):
        if o.parent is None and o.type == "MESH" and o.name != "Display ground":
            bpy.data.objects.remove(o, do_unlink=True)
    root = bpy.data.objects["ROVER"]
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    PARTS = ("Wheel drum", "Outer rim", "Hub", "Wheel tread", "Wheel spoke")
    parts = list(root.children)
    wheels = []
    for side in (-1, 1):
        for y in (-1.03, 0.0, 1.03):
            cx = side * 1.02
            w = pivot(f"WHEEL_{'L' if side > 0 else 'R'}_{['FRONT', 'MID', 'REAR'][int(round(y / 1.03)) + 1]}", root, (cx, y, 0.37))
            for o in parts:
                l = o.location
                if base(o.name) in PARTS and abs(l.x - cx) < 0.3 and math.hypot(l.y - y, l.z - 0.37) < 0.42:
                    reparent(o, w)
            wheels.append(w)

    R = 3.0
    RAMP = 10

    def clip(turn):
        arc = int(round((abs(turn) * R) / SPEED)) if turn else 0
        frames = (arc + 2 * RAMP + 1) if turn else 97
        pts = path(frames, turn, RAMP if turn else 0)
        cxr = (R if turn > 0 else -R) if turn else None
        d = {}

        def rfn(i):
            x, y, yaw = pts[i]
            return [("location", (x, y, 0)), ("rotation_euler", (0, 0, yaw))]
        d[root] = rfn
        for w in wheels:
            wx, wy = w.location.x, w.location.y
            if turn:
                steer = math.atan(-wy / (cxr - wx))
                factor = math.hypot(cxr - wx, wy) / R
            else:
                steer, factor = 0.0, 1.0

            def wfn(i, steer=steer, factor=factor):
                if turn:
                    k = smooth(min(1.0, i / RAMP, (frames - 1 - i) / RAMP))
                    dist = 0.0
                    for j in range(1, i + 1):
                        kj = min(1.0, j / RAMP, (frames - 1 - j) / RAMP)
                        dist += SPEED * (1 + (factor - 1) * max(0.0, kj))
                else:
                    k, dist = 0.0, SPEED * i
                return [("rotation_euler", (dist / WHEEL_R, 0, steer * k))]
            d[w] = wfn
        return frames, d

    clips = []
    for name, turn in (("Drive", 0), ("DriveLeft", math.pi / 2), ("DriveRight", -math.pi / 2)):
        frames, d = clip(turn)
        clips.append((name, frames, d))
    return root, bake(clips), "mars_rover"


root, end, stem = astronaut() if KIND == "astronaut" else rover()
setup_view(root, end)

bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for c in root.children_recursive:
    c.select_set(True)
err = None
try:
    bpy.ops.export_scene.gltf(filepath=os.path.join(D, stem + "_animated.glb"), use_selection=True,
                              export_format="GLB", export_apply=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS")
except Exception as e:
    err = str(e)
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, stem + "_animated.blend"))
result = {"end": end, "objects": len(bpy.data.objects), "export_error": err}
