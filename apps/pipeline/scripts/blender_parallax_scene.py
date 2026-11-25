"""Blender scene for the clip stage: turn a still and its depth map into a seamless parallax loop.

Blender's own Python runs this, not the pipeline's venv (lib/parallax.py starts it):
    Blender -b --factory-startup -P scripts/blender_parallax_scene.py -- \
        --image still.png --depth depth.npy --out loop.mp4
With ``--frames 1,150`` it writes those frames as PNGs into the --out folder instead, for a quick look.

Each pixel becomes a vertex placed along the camera ray through that pixel, at its
estimated depth. Seen from the rest position the mesh reproduces the still exactly;
when the camera drifts, near things move against far things. The camera path, dust
drift and light flicker are all periodic in the loop length, so the last frame runs
into the first and ffmpeg can repeat the loop for a clip of any length.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--depth", required=True, help=".npy, 0 = far, 1 = near")
    p.add_argument("--out", required=True, help="the loop .mp4, or a folder for --frames")
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--seconds", type=float, default=10.0, help="loop length")
    p.add_argument("--frames", default="", help="write only these frames as PNGs, e.g. 1,75,150")
    p.add_argument("--samples", type=int, default=24)
    p.add_argument("--fov", type=float, default=42.0, help="vertical field of view of the still, degrees")
    p.add_argument("--overscan", type=float, default=1.10, help="crop factor that hides the mesh edges")
    p.add_argument("--near", type=float, default=2.2, help="distance of the nearest pixel")
    p.add_argument("--far", type=float, default=9.0, help="distance of the farthest pixel")
    p.add_argument("--grid-cols", type=int, default=360, help="mesh vertices across the still")
    p.add_argument("--drift", type=float, default=0.13, help="sideways camera drift")
    p.add_argument("--push", type=float, default=0.35, help="push-in distance at mid-loop")
    p.add_argument("--focus-uv", default="0.5,0.6", help="subject whose depth the camera orbits around and focuses on (u,v from top-left)")
    p.add_argument("--fstop", type=float, default=1.4)
    p.add_argument("--dust", type=int, default=70)
    p.add_argument("--haze", type=float, default=0.015, help="volume density")
    p.add_argument("--flicker", type=float, default=0.05, help="emission flicker amplitude")
    return p.parse_args(argv)


def reset_scene() -> bpy.types.Scene:
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    return bpy.context.scene


def set_engine(scene: bpy.types.Scene) -> None:
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = name
            return
        except TypeError:
            continue
    raise RuntimeError("EEVEE is not available")


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return a
    k = 2 * r + 1
    pad = np.pad(a, r, mode="edge")
    c = pad.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def max_filter(a: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return a
    pad = np.pad(a, r, mode="edge")
    h, w = a.shape
    out = a.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                np.maximum(out, pad[r + dy:r + dy + h, r + dx:r + dx + w], out=out)
    return out


class Projection:
    """Maps image coordinates and disparity to scene positions, camera at the origin looking down -Z."""

    def __init__(self, width: int, height: int, fov_deg: float, near: float, far: float):
        self.aspect = width / height
        self.tv = math.tan(math.radians(fov_deg) / 2)
        self.th = self.tv * self.aspect
        self.near, self.far = near, far

    def distance(self, disparity):
        # Interpolate in inverse depth: the model predicts something close to disparity.
        return 1.0 / (disparity / self.near + (1.0 - disparity) / self.far)

    def point(self, u, v, disparity):
        z = self.distance(disparity)
        x = (2 * u - 1) * self.th * z
        y = (1 - 2 * v) * self.tv * z
        return x, y, -z


def build_mesh(image: bpy.types.Image, depth: np.ndarray, proj: Projection, step: int) -> bpy.types.Object:
    h, w = depth.shape
    # Grow near regions a few pixels before softening, so the stretched faces at a depth
    # jump carry background colour rather than smearing the edge of the subject.
    soft = box_blur(max_filter(depth, 3), 1)
    cols = np.arange(0, w + step - 1, step).clip(max=w - 1)
    rows = np.arange(0, h + step - 1, step).clip(max=h - 1)
    gu = (cols + 0.5) / w
    gv = (rows + 0.5) / h
    gu[0], gu[-1], gv[0], gv[-1] = 0.0, 1.0, 0.0, 1.0
    U, V = np.meshgrid(gu, gv)
    D = soft[np.ix_(rows, cols)]
    X, Y, Z = proj.point(U, V, D)
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    nr, nc = len(rows), len(cols)
    idx = np.arange(nr * nc).reshape(nr, nc)
    quads = np.stack([idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:], idx[:-1, :-1]], -1).reshape(-1, 4)

    mesh = bpy.data.meshes.new("still")
    mesh.from_pydata(verts.tolist(), [], quads.tolist())
    uv = mesh.uv_layers.new(name="uv")
    vert_uv = np.stack([U.ravel(), 1.0 - V.ravel()], -1)
    loop_verts = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_verts)
    uv.data.foreach_set("uv", vert_uv[loop_verts].ravel().astype(np.float32))
    mesh.update()

    mat = bpy.data.materials.new("still")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.name = "glow"
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    mesh.materials.append(mat)

    obj = bpy.data.objects.new("still", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def loop_expr(base: float, terms: list[tuple[float, int, float]], frames: int) -> str:
    """A driver expression periodic in ``frames``: base + sum(a * sin(tau * (k * t + phase)))."""
    parts = [f"{base:.5f}"]
    for amp, k, phase in terms:
        parts.append(f"{amp:+.5f}*sin(6.2831853*({k}*(frame-1)/{frames}+{phase:.4f}))")
    return "".join(parts)


def add_driver(target, path: str, index: int, expr: str) -> None:
    fc = target.driver_add(path, index) if index >= 0 else target.driver_add(path)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = expr


def flicker_terms(rng: random.Random, amp: float) -> list[tuple[float, int, float]]:
    # A few incommensurate-looking harmonics of the loop read as irregular flicker.
    return [(amp * w, k, rng.random()) for w, k in ((0.5, 3), (0.3, 7), (0.2, 13))]


def main() -> None:
    args = parse_args()
    started = time.monotonic()
    rng = random.Random(7)
    scene = reset_scene()
    set_engine(scene)

    image = bpy.data.images.load(str(Path(args.image).resolve()))
    image.colorspace_settings.name = "sRGB"
    iw, ih = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(ih, iw, 4)[::-1, :, :3]  # top row first
    depth = np.load(args.depth).astype(np.float32)
    assert depth.shape == (ih, iw), f"depth {depth.shape} does not match image {(ih, iw)}"

    proj = Projection(iw, ih, args.fov, args.near, args.far)
    build_mesh(image, depth, proj, max(1, round(iw / args.grid_cols)))

    frames = round(args.seconds * args.fps)
    scene.frame_start, scene.frame_end = 1, frames
    scene.render.fps = args.fps
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100

    # Orbit pivot and focus: on the view axis, at the subject's depth (median of a patch
    # around it). On the axis, so the camera at rest frames the still exactly.
    fu, fv = (float(x) for x in args.focus_uv.split(","))
    px, py = int(fu * (iw - 1)), int(fv * (ih - 1))
    r = max(4, iw // 36)
    patch = depth[max(py - r, 0):py + r, max(px - r, 0):px + r]
    target_pos = Vector((0.0, 0.0, -proj.distance(float(np.median(patch)))))
    target = bpy.data.objects.new("target", None)
    target.location = target_pos
    scene.collection.objects.link(target)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 24.0
    cam_data.lens = 12.0 / (proj.tv / args.overscan)
    cam_data.clip_start, cam_data.clip_end = 0.05, args.far * 3
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = target
    cam_data.dof.aperture_fstop = args.fstop
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Orbit: sideways figure-eight plus a slow push-in and back, aimed at the target so it holds still.
    add_driver(cam, "location", 0, loop_expr(0.0, [(args.drift, 1, 0.0)], frames))
    add_driver(cam, "location", 1, loop_expr(0.0, [(args.drift * 0.35, 2, 0.0)], frames))
    add_driver(cam, "location", 2, loop_expr(-args.push / 2, [(args.push / 2, 1, 0.25)], frames))
    # Damped Track turns the view axis toward the target by the smallest rotation, so the
    # camera keeps its upright roll (Track To would aim "up" along the view axis here).
    track = cam.constraints.new("DAMPED_TRACK")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"

    # Plane glow flicker, as if the scene's own light source breathes.
    glow = bpy.data.materials["still"].node_tree.nodes["glow"]
    add_driver(glow.inputs["Strength"], "default_value", -1, loop_expr(1.0, flicker_terms(rng, args.flicker), frames))

    # A light at the brightest region, coloured like it, so the haze glows from the right place.
    br = max(4, iw // 30)
    lum = box_blur(pixels @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), br)
    by, bx = np.unravel_index(np.argmax(lum), lum.shape)
    bright_col = pixels[max(by - br, 0):by + br, max(bx - br, 0):bx + br].reshape(-1, 3).mean(0)
    bright_col = bright_col / max(bright_col.max(), 1e-3)
    lp = Vector(proj.point((bx + 0.5) / iw, (by + 0.5) / ih, float(depth[by, bx])))
    lp.z += 0.6  # just in front of the surface it comes from
    light_data = bpy.data.lights.new("source", "POINT")
    light_data.color = tuple(float(c) for c in bright_col)
    light_data.shadow_soft_size = 1.2
    # No shadows: the stretched faces at depth jumps would cast hard-edged wedges into the haze.
    light_data.use_shadow = False
    light_data.energy = 600.0
    light = bpy.data.objects.new("source", light_data)
    light.location = lp
    scene.collection.objects.link(light)
    add_driver(light_data, "energy", -1, loop_expr(600.0, [(600.0 * a * 4, k, ph) for a, k, ph in flicker_terms(rng, args.flicker)], frames))

    # Haze filling the space between the camera and the far wall.
    if args.haze > 0:
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        vol = bpy.context.active_object
        vol.name = "haze"
        span = args.far * 1.2
        vol.scale = (proj.th * span * 2.4, proj.tv * span * 2.4, span)
        vol.location = (0, 0, -span / 2 - 0.1)
        vmat = bpy.data.materials.new("haze")
        vmat.use_nodes = True
        vnt = vmat.node_tree
        vnt.nodes.clear()
        pv = vnt.nodes.new("ShaderNodeVolumePrincipled")
        avg = pixels.reshape(-1, 3).mean(0)
        pv.inputs["Color"].default_value = (*(avg / max(avg.max(), 1e-3)), 1.0)
        pv.inputs["Density"].default_value = args.haze
        vout = vnt.nodes.new("ShaderNodeOutputMaterial")
        vnt.links.new(pv.outputs["Volume"], vout.inputs["Volume"])
        vol.data.materials.append(vmat)

    # Dust motes: tiny emissive specks in front of the focus plane, tinted by the pixels behind them.
    if args.dust > 0:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0)
        speck = bpy.context.active_object
        speck_mesh = speck.data
        bpy.data.objects.remove(speck)
        dmat = bpy.data.materials.new("dust")
        dmat.use_nodes = True
        dnt = dmat.node_tree
        dnt.nodes.clear()
        info = dnt.nodes.new("ShaderNodeObjectInfo")
        demit = dnt.nodes.new("ShaderNodeEmission")
        demit.inputs["Strength"].default_value = 2.5
        dout = dnt.nodes.new("ShaderNodeOutputMaterial")
        dnt.links.new(info.outputs["Color"], demit.inputs["Color"])
        dnt.links.new(demit.outputs["Emission"], dout.inputs["Surface"])
        speck_mesh.materials.append(dmat)
        focus_z = -target_pos.z
        for i in range(args.dust):
            u, v = rng.uniform(0.02, 0.98), rng.uniform(0.02, 0.98)
            z = rng.uniform(args.near * 0.55, focus_z * 1.15)
            x, y = (2 * u - 1) * proj.th * z, (1 - 2 * v) * proj.tv * z
            col = pixels[int(v * (ih - 1)), int(u * (iw - 1))]
            col = 0.35 + 0.65 * col / max(float(col.max()), 1e-3)
            ob = bpy.data.objects.new(f"dust{i}", speck_mesh)
            ob.scale = (z * 0.0013 * rng.uniform(0.5, 1.3),) * 3
            ob.color = (*col.tolist(), 1.0)
            scene.collection.objects.link(ob)
            a = z * 0.02
            for axis, base in enumerate((x, y, -z)):
                k = rng.choice((1, 1, 2))
                extra = [(a * 0.3, 3, rng.random())] if axis < 2 else []
                add_driver(ob, "location", axis, loop_expr(base, [(a, k, rng.random())] + extra, frames))

    # Keep the still's colours: no filmic curve.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = world
    ee = scene.eevee
    ee.taa_render_samples = args.samples
    for attr, value in (("volumetric_tile_size", "4"), ("volumetric_samples", 64),
                        ("volumetric_end", args.far * 1.5), ("use_volumetric_shadows", False)):
        if hasattr(ee, attr):
            setattr(ee, attr, value)

    print(f"scene built in {time.monotonic() - started:.1f}s; {frames} frames per loop")
    render_start = time.monotonic()
    out = Path(args.out).resolve()
    im = scene.render.image_settings
    if args.frames:
        out.mkdir(parents=True, exist_ok=True)
        im.file_format = "PNG"
        im.color_mode = "RGB"
        for f in (int(f) for f in args.frames.split(",") if f):
            scene.frame_set(f)
            scene.render.filepath = str(out / f"f_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        if hasattr(im, "media_type"):  # Blender 5: choose video before the container
            im.media_type = "VIDEO"
        im.file_format = "FFMPEG"
        ff = scene.render.ffmpeg
        ff.format = "MPEG4"
        ff.codec = "H264"
        ff.constant_rate_factor = "PERC_LOSSLESS"  # the clip stage re-encodes it
        ff.audio_codec = "NONE"
        scene.render.use_file_extension = False
        scene.render.filepath = str(out)
        bpy.ops.render.render(animation=True)
    print(f"rendered in {time.monotonic() - render_start:.1f}s")


main()
