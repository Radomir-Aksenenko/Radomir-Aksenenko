"""Builds a city from a year of contributions and photographs it with Cycles.

One tower stands for one week, oldest on the left. A tower's look is seeded by the
date of its week, so a building keeps its face as the skyline moves along: the city
gets rebuilt by the data, it is not redrawn at random.

Writes two float EXRs: <out>_beauty.exr (scene-linear) and <out>_depth.exr (1000 / metres).
photo.py turns them into a press photograph, haze and film included.

Usage: python city.py <layout.json> <out-stem> --tex <dir> --sky <hdr>
                      [--width 1620] [--height 1100] [--samples 96] [--device gpu|cpu] [--threads 0]
"""
import argparse
import json
import math
import os
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

TILE = 21.6  # six floors of 3.6 m to one repeat of a facade texture
SLOT = 12.5


class Mesh:
    """Unwelded quads: every face owns its corners, so each can carry its own UV and tint."""

    def __init__(self):
        self.v, self.f, self.uv, self.col = [], [], [], []

    def poly(self, pts, uvs, tint):
        i = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(i, i + len(pts))))
        self.uv.extend(uvs)
        self.col.extend([tint] * len(pts))

    def wall(self, a, b, z0, z1, tint, ru, rv, a2=None, b2=None):
        """Quad from edge a-b at z0 to edge a2-b2 at z1, with UVs in metres / TILE."""
        a2, b2 = a2 or a, b2 or b
        run = math.dist(a, b)
        u0 = ru
        u1 = ru + run / TILE
        v0, v1 = rv + z0 / TILE, rv + z1 / TILE
        self.poly(
            [(a[0], a[1], z0), (b[0], b[1], z0), (b2[0], b2[1], z1), (a2[0], a2[1], z1)],
            [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
            tint,
        )

    def box(self, x0, x1, y0, y1, z0, z1, tint, ru=0.0, rv=0.0, shrink=0.0, top=True):
        """Counter-clockwise from above. shrink pulls the top ring in, making a frustum."""
        s = shrink
        rings = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        upper = [(x0 + s, y0 + s), (x1 - s, y0 + s), (x1 - s, y1 - s), (x0 + s, y1 - s)]
        for k in range(4):
            j = (k + 1) % 4
            # Each face slides along the texture, so corners never line up like a pattern.
            self.wall(rings[k], rings[j], z0, z1, tint, ru + k * .37, rv, upper[k], upper[j])
        if top:
            self.poly([(*p, z1) for p in upper], [(.01, .01)] * 4, tint)

    def cyl(self, cx, cy, r, z0, z1, tint, n=10, r2=None, cap=True):
        r2 = r if r2 is None else r2
        ring = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        upper = [(cx + r2 * math.cos(2 * math.pi * k / n), cy + r2 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        for k in range(n):
            j = (k + 1) % n
            self.wall(ring[k], ring[j], z0, z1, tint, 0, 0, upper[k], upper[j])
        if cap and r2 > 0:
            self.poly([(*p, z1) for p in upper], [(.01, .01)] * n, tint)


def grey(v, warm=.03):
    return (v * (1 + warm), v, v * (1 - warm), 1.0)


class City:
    def __init__(self, grid=0.0):
        self.m = {k: Mesh() for k in ('f18', 'f19', 'f20', 'stone', 'tar', 'timber')}
        self.grid = grid  # the street grid runs at an angle to the lens, so every block shows two faces
        self.stacks = []  # (x, y, z, radius) of whatever is smoking

    def mark(self):
        return {k: len(m.v) for k, m in self.m.items()}

    def turn(self, marks, cx, cy, angle=None):
        """Swing everything built since mark() around (cx, cy). Winding survives a rotation."""
        a = self.grid if angle is None else angle
        ca, sa = math.cos(a), math.sin(a)
        for k, m in self.m.items():
            for i in range(marks[k], len(m.v)):
                x, y, z = m.v[i]
                dx, dy = x - cx, y - cy
                m.v[i] = (cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, z)

    def plant(self, r, x, y, n=4):
        """A generating station on the bank: a brick hall and a row of tall stacks."""
        marks = self.mark()
        w, d = 22.0 * n, 36.0
        self.block(r, 'f20', grey(.42, .08), grey(.34), x - w / 2, x + w / 2, y, y + d, 0, 34, ledge=True)
        self.m['tar'].box(x - w / 2 + 1, x + w / 2 - 1, y + 1, y + d - 1, 34, 41, grey(.05), shrink=9)
        tops = []
        for k in range(n):
            sx = x - w / 2 + 11 + 22 * k
            sy = y + d * .5
            top = r.uniform(92, 108)
            self.m['stone'].cyl(sx, sy, 4.4, 34, top, grey(.1, .05), 14, r2=2.9, cap=False)  # soot-black brick
            self.m['tar'].cyl(sx, sy, 3.15, top, top + 2.2, grey(.03), 14, cap=True)
            tops.append((sx, sy, top + 2, 3.0))
        self.turn(marks, x, y + d / 2)
        ca, sa = math.cos(self.grid), math.sin(self.grid)
        for sx, sy, z, rad in tops:
            dx, dy = sx - x, sy - (y + d / 2)
            self.stacks.append((x + dx * ca - dy * sa, y + d / 2 + dx * sa + dy * ca, z, rad))

    # ---- roofs -----------------------------------------------------------------------------
    def water_tank(self, r, x, y, z):
        m, t = self.m['timber'], grey(r.uniform(.11, .2))
        rad = r.uniform(1.8, 3.0)
        h = r.uniform(4.2, 6.2)
        legs = r.uniform(3.2, 5.0)
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            self.m['tar'].box(x + dx * rad * .7 - .14, x + dx * rad * .7 + .14, y + dy * rad * .7 - .14, y + dy * rad * .7 + .14, z, z + legs, grey(.03))
        m.cyl(x, y, rad, z + legs, z + legs + h, t, 12, cap=False)
        self.m['tar'].cyl(x, y, rad * 1.05, z + legs + h, z + legs + h + rad * .55, grey(.05), 12, r2=.05, cap=False)

    def roof_clutter(self, r, x0, x1, y0, y1, z, big=False):
        wd, dp = x1 - x0, y1 - y0
        if wd < 5 or dp < 5:
            return
        # Elevator house, off centre.
        if r.random() < .85:
            bw, bd, bh = wd * r.uniform(.22, .42), dp * r.uniform(.25, .45), r.uniform(3.5, 7)
            bx, by = r.uniform(x0 + 1, x1 - 1 - bw), r.uniform(y0 + 1, y1 - 1 - bd)
            self.m['stone'].box(bx, bx + bw, by, by + bd, z, z + bh, grey(r.uniform(.2, .36)))
        for _ in range(r.integers(1, 3) if not big else 2):
            if r.random() < .75:
                self.water_tank(r, r.uniform(x0 + 2, x1 - 2), r.uniform(y0 + 2, y1 - 2), z)
        for _ in range(r.integers(0, 4)):
            cx, cy = r.uniform(x0 + .5, x1 - .5), r.uniform(y0 + .5, y1 - .5)
            self.m['stone'].box(cx - .6, cx + .6, cy - .6, cy + .6, z, z + r.uniform(1.5, 5), grey(r.uniform(.12, .26)))

    # ---- facades ---------------------------------------------------------------------------
    def ribs(self, r, x0, x1, y0, y1, z0, z1, tint, pitch, depth=.55):
        """Piers standing proud of the wall. They are what catches a low sun."""
        for a, b, fixed, normal in ((x0, x1, y0, -1), (y0, y1, x1, 1), (x0, x1, y1, 1), (y0, y1, x0, -1)):
            count = max(2, int((b - a) / pitch))
            horizontal = a == x0 and b == x1
            for k in range(count + 1):
                c = a + (b - a) * k / count
                half = .34
                if horizontal:
                    self.m['stone'].box(c - half, c + half, min(fixed, fixed + normal * depth), max(fixed, fixed + normal * depth), z0, z1, tint, top=False)
                else:
                    self.m['stone'].box(min(fixed, fixed + normal * depth), max(fixed, fixed + normal * depth), c - half, c + half, z0, z1, tint, top=False)

    def block(self, r, face, tint, trim, x0, x1, y0, y1, z0, z1, ribbed=False, pitch=5.4, ledge=True):
        ru, rv = r.random(), round(r.random() * 6) / 6
        self.m[face].box(x0, x1, y0, y1, z0, z1, tint, ru, rv)
        if ribbed:
            self.ribs(r, x0, x1, y0, y1, z0, z1, trim, pitch)
        if ledge:
            # A cornice: a heavy course and a thin one under it, so it reads at any size.
            o = r.uniform(.5, 1.1)
            self.m['stone'].box(x0 - o, x1 + o, y0 - o, y1 + o, z1 - .9, z1 + .25, trim)
            self.m['stone'].box(x0 - o * .4, x1 + o * .4, y0 - o * .4, y1 + o * .4, z1 - 2.6, z1 - 2.1, trim, top=False)

    # ---- one week --------------------------------------------------------------------------
    def tower(self, week_seed, x, y, h, heft, record=False):
        """h is the height of the masonry. heft (0..1) is the week's share of the record."""
        marks = self.mark()
        try:
            self._tower(week_seed, x, y, h, heft, record)
        finally:
            self.turn(marks, x, y)

    def _tower(self, week_seed, x, y, h, heft, record=False):
        r = np.random.default_rng(week_seed)
        face = r.choice(['f18', 'f19', 'f20'])
        tone = r.choice([.24, .34, .46, .6, .8], p=[.2, .25, .25, .18, .12])
        warm = r.uniform(-.01, .10)
        tint = grey(tone, warm)
        trim = grey(min(.62, tone * r.uniform(.72, .98)), warm * .6)
        ribbed = bool(r.random() < .55)
        w = 19 + 31 * heft ** .75 + r.uniform(0, 8)
        d = w * r.uniform(.85, 1.25)
        x0, x1, y0, y1 = x - w / 2, x + w / 2, y - d / 2, y + d / 2

        if h < 62:  # a walk-up block with a parapet
            self.block(r, face, tint, trim, x0, x1, y0, y1, 0, h)
            self.roof_clutter(r, x0, x1, y0, y1, h)
            return

        if h < 135:  # office block: podium, shaft, one or two setbacks
            base = h * r.uniform(.28, .46)
            self.block(r, face, tint, trim, x0, x1, y0, y1, 0, base)
            ins = w * r.uniform(.07, .14)
            self.block(r, face, tint, trim, x0 + ins, x1 - ins, y0 + ins, y1 - ins, base, h * .86, ribbed)
            ins2 = ins + w * r.uniform(.08, .14)
            self.block(r, face, tint, trim, x0 + ins2, x1 - ins2, y0 + ins2, y1 - ins2, h * .86, h)
            self.roof_clutter(r, x0 + ins2, x1 - ins2, y0 + ins2, y1 - ins2, h)
            return

        # A skyscraper of the zoning law: wedding-cake setbacks, then a shaft, then a crown.
        n = int(r.integers(3, 6)) + (1 if h > 300 else 0)
        z, inset = 0.0, 0.0
        # Fractions fall toward the top, except the shaft, which takes the longest run.
        stops = np.array([.16, .11, .09, .07, .06, .05][:n - 1], np.float32) * r.uniform(.9, 1.15)
        heights = list(stops) + [1 - float(stops.sum())]
        step = w * r.uniform(.055, .085)
        for k, frac in enumerate(heights):
            top = z + h * frac
            ib = inset
            self.block(r, face, tint, trim, x0 + ib, x1 - ib, y0 + ib, y1 - ib, z, top, ribbed and k >= 1, pitch=r.uniform(4.2, 6.2))
            z, inset = top, inset + step
        cx0, cx1, cy0, cy1 = x0 + inset - step, x1 - inset + step, y0 + inset - step, y1 - inset + step
        kind = r.choice([0, 1, 2, 3], p=[.34, .12, .22, .32])
        cw = cx1 - cx0
        if kind == 0:  # stepped pyramid
            for k in range(4):
                s = cw * .13 * k
                self.m['stone'].box(cx0 + s, cx1 - s, cy0 + s, cy1 - s, z + k * h * .018, z + (k + 1) * h * .018, trim)
            z += 4 * h * .018
            self.m['tar'].box(x - 1.2, x + 1.2, y - 1.2, y + 1.2, z, z + h * .10, grey(.1), shrink=1.1, top=False)
        elif kind == 1:  # copper-style hipped roof
            self.m['tar'].box(cx0, cx1, cy0, cy1, z, z + cw * .34, grey(r.uniform(.05, .12)), shrink=cw * .3)
            z += cw * .34
        elif kind == 2:  # a tall radiating crown and a needle
            self.m['stone'].box(cx0, cx1, cy0, cy1, z, z + h * .03, trim, shrink=cw * .05)
            z += h * .03
            self.m['stone'].box(cx0 + cw * .05, cx1 - cw * .05, cy0 + cw * .05, cy1 - cw * .05, z, z + h * .07, trim, shrink=cw * .34)
            z += h * .07
            self.m['tar'].box(x - .9, x + .9, y - .9, y + .9, z, z + h * .12, grey(.14), shrink=.85, top=False)
        else:  # flat with plant rooms
            self.roof_clutter(r, cx0, cx1, cy0, cy1, z, big=True)
        if record:
            # The record week flies a mast, so it can be found from across the river.
            self.m['tar'].box(x - .7, x + .7, y - .7, y + .7, z, z + h * .16, grey(.08), shrink=.62, top=False)

    # ---- the rest of the town ---------------------------------------------------------------
    def back_town(self, r, width):
        for _ in range(int(width * 1.5)):
            x = r.uniform(-width * .68, width * .68)
            y = r.uniform(190, 1500)
            # The town climbs away from the river: the far belts carry their own towers.
            h = min(r.gamma(3.2, 15) + 16, 90 + y * .09)
            w, d = r.uniform(16, 40), r.uniform(16, 40)
            face = r.choice(['f18', 'f19', 'f20'])
            tone = r.uniform(.3, .85)
            marks = self.mark()
            self.m[face].box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, 0, h, grey(tone), r.random(), 0)
            if r.random() < .5:
                self.m[face].box(x - w * .3, x + w * .3, y - d * .3, y + d * .3, h, h * r.uniform(1.08, 1.32), grey(tone), r.random(), 0)
            self.turn(marks, x, y)

    def street_blocks(self, r, width, shore):
        """Six to twelve storeys, wall to wall, between the river and the week towers."""
        for row, (y, hi) in enumerate(((-38, 30), (-8, 38), (22, 44))):
            x = -width * .7
            while x < width * .7:
                w = r.uniform(11, 34)
                h = r.uniform(14, hi)
                d = r.uniform(14, 26)
                face = r.choice(['f18', 'f19', 'f20'])
                tone = float(r.choice([.26, .38, .5, .68]))
                marks = self.mark()
                self.block(r, face, grey(tone, .07), grey(tone * .9), x, x + w, y, y + d, 0, h, ledge=r.random() < .7)
                if r.random() < .6:
                    self.roof_clutter(r, x, x + w, y, y + d, h)
                self.turn(marks, x + w / 2, y + d / 2)
                x += w + (r.uniform(4, 10) if r.random() < .22 else r.uniform(0, .6))  # now and then a cross street

    def waterfront(self, r, width, shore):
        """Warehouses along the bank, piers into the river, and what ties up at them."""
        x = -width * .68
        while x < width * .68:
            w = r.uniform(16, 46)
            h = r.uniform(7, 21)
            y0 = shore + r.uniform(16, 42)
            d = r.uniform(18, 44)
            face = r.choice(['f18', 'f19', 'f20'])
            marks = self.mark()
            tone = r.uniform(.2, .55)
            self.block(r, face, grey(tone, .08), grey(tone * .9), x, x + w, y0, y0 + d, 0, h)
            if r.random() < .55:
                self.roof_clutter(r, x, x + w, y0, y0 + d, h)
            self.turn(marks, x + w / 2, y0 + d / 2)
            x += w + r.uniform(0, 7)
        # Bank wall.
        self.m['stone'].box(-width * 2, width * 2, shore, shore + 12, -5, 2.6, grey(.16))
        self.m['stone'].box(-width * 2, width * 2, shore + 12, shore + 900, -.2, .1, grey(.11), top=True)
        # Piers: long sheds on timber legs.
        x = -width * .72
        while x < width * .72:
            pw, pl = r.uniform(14, 22), r.uniform(40, 80)
            py0, py1 = shore - pl, shore + 4
            self.m['stone'].box(x, x + pw, py0, py1, -.4, 1.5, grey(.05))
            shed = r.uniform(6.5, 10.5)
            tone = r.uniform(.1, .22)
            self.m['f20'].box(x + 1.5, x + pw - 1.5, py0 + 8, py1 - 2, 1.5, 1.5 + shed, grey(tone), r.random(), 0, top=False)
            self.m['tar'].box(x + .9, x + pw - .9, py0 + 7.4, py1 - 1.4, 1.5 + shed, 1.5 + shed + pw * .17, grey(.06), shrink=pw * .3)
            self.m['stone'].box(x + 1.1, x + pw - 1.1, py0 + 7.8, py0 + 8.4, 1.5 + shed, 1.5 + shed + pw * .13, grey(tone + .16), shrink=0, top=False)
            for k in range(int(pl / 4)):  # the legs at the waterline
                yy = py0 + k * 4
                for xx in (x + .3, x + pw - .3):
                    self.m['timber'].box(xx - .24, xx + .24, yy - .24, yy + .24, -6, 0, grey(.05), top=False)
            # Something moored at about every other pier.
            x += pw + r.uniform(48, 96)


# ---- materials ----------------------------------------------------------------------------------
def image_node(nt, path, colour=True):
    n = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    n.image = img
    n.interpolation = 'Smart'
    return n


def pbr(name, stem, tex, facade=True, lit=0.0):
    """A facade with tint from the mesh, soot running down the wall, real normal and roughness."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    col = image_node(nt, tex / f'{stem}_Color.jpg')
    tint = nt.nodes.new('ShaderNodeAttribute')
    tint.attribute_name = 'tint'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1
    nt.links.new(col.outputs['Color'], mul.inputs['A'])
    nt.links.new(tint.outputs['Color'], mul.inputs['B'])
    # Soot: streaks long in z, patchy along the wall, heavier the nearer the street.
    coord = nt.nodes.new('ShaderNodeNewGeometry')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (.20, .20, .018)
    nt.links.new(coord.outputs['Position'], mp.inputs['Vector'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 7
    noise.inputs['Roughness'].default_value = .62
    nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .32
    ramp.color_ramp.elements[0].color = (.42, .42, .42, 1)
    ramp.color_ramp.elements[1].position = .68
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    soot = nt.nodes.new('ShaderNodeMix')
    soot.data_type = 'RGBA'
    soot.blend_type = 'MULTIPLY'
    soot.inputs['Factor'].default_value = 1
    nt.links.new(mul.outputs['Result'], soot.inputs['A'])
    nt.links.new(ramp.outputs['Color'], soot.inputs['B'])
    nt.links.new(soot.outputs['Result'], p.inputs['Base Color'])
    if (tex / f'{stem}_Roughness.jpg').exists():
        nt.links.new(image_node(nt, tex / f'{stem}_Roughness.jpg', False).outputs['Color'], p.inputs['Roughness'])
    if (tex / f'{stem}_Metalness.jpg').exists():
        nt.links.new(image_node(nt, tex / f'{stem}_Metalness.jpg', False).outputs['Color'], p.inputs['Metallic'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 1.4
    nt.links.new(image_node(nt, tex / f'{stem}_NormalGL.jpg', False).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], p.inputs['Normal'])
    return mat


def plain(name, rough=.7, stem=None, tex=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    tint = nt.nodes.new('ShaderNodeAttribute')
    tint.attribute_name = 'tint'
    p.inputs['Roughness'].default_value = rough
    if stem:
        c = image_node(nt, tex / f'{stem}_Color.jpg')
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1
        nt.links.new(c.outputs['Color'], mul.inputs['A'])
        nt.links.new(tint.outputs['Color'], mul.inputs['B'])
        nt.links.new(mul.outputs['Result'], p.inputs['Base Color'])
    else:
        nt.links.new(tint.outputs['Color'], p.inputs['Base Color'])
    return mat


def water_material():
    mat = bpy.data.materials.new('river')
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (.012, .014, .014, 1)
    p.inputs['Roughness'].default_value = .085
    p.inputs['IOR'].default_value = 1.33
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    bump_total = None
    # Chop: wavelets stretched along the bank, foreshortened by the low camera.
    for scale, strength, detail in (((.08, .62, 1), .9, 6), ((.018, .13, 1), 1.0, 5)):
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        nt.links.new(geo.outputs['Position'], mp.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = .58
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = .55
        nt.links.new(n.outputs['Fac'], b.inputs['Height'])
        if bump_total is not None:
            nt.links.new(bump_total.outputs['Normal'], b.inputs['Normal'])
        bump_total = b
    nt.links.new(bump_total.outputs['Normal'], p.inputs['Normal'])
    return mat


def to_object(name, m, mat):
    if not m.f:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(m.v, [], m.f)
    uv = me.uv_layers.new(name='UVMap')
    uv.uv.foreach_set('vector', np.array(m.uv, np.float32).ravel())
    col = me.color_attributes.new('tint', 'FLOAT_COLOR', 'CORNER')
    col.data.foreach_set('color', np.array(m.col, np.float32).ravel())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('layout')
    ap.add_argument('out')
    ap.add_argument('--tex', required=True)
    ap.add_argument('--sky', required=True)
    ap.add_argument('--width', type=int, default=1800)
    ap.add_argument('--height', type=int, default=1080)
    ap.add_argument('--samples', type=int, default=96)
    ap.add_argument('--device', default=os.environ.get('RENDER_DEVICE', 'cpu'))
    ap.add_argument('--threads', type=int, default=0)
    ap.add_argument('--sky-rot', type=float, default=155)
    ap.add_argument('--sky-gain', type=float, default=1.0)
    ap.add_argument('--sun', type=float, default=7.5)
    ap.add_argument('--grid', type=float, default=33)
    ap.add_argument('--cam', type=float, default=900)
    a = ap.parse_args(argv)
    lay = json.loads(Path(a.layout).read_text(encoding='utf8'))
    weeks = lay['weeks']
    dates = lay.get('weekDates') or [str(i) for i in range(len(weeks))]
    out = Path(a.out).absolute()
    tex = Path(a.tex).absolute()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene

    # ---- the town -----------------------------------------------------------------------------
    n = len(weeks)
    peak = max(max(weeks), 1)
    width = n * SLOT
    c = City(math.radians(a.grid))
    city_rng = np.random.default_rng(1944)
    shore_y = -92
    aspect = a.width / a.height
    horizon_from_bottom = .15
    # What the frame holds above the waterline at the depth of the towers, less room for crowns.
    cam_y = -float(a.cam)
    lens_frame = width * 1.03 * (140 - cam_y) / (34 - cam_y)
    head_room = (1 - horizon_from_bottom) * lens_frame / aspect
    tallest = head_room * .74
    for i, v in enumerate(weeks):
        heft = math.sqrt(v / peak)
        h = 26 + heft * (tallest - 26) if v else city_rng.uniform(15, 22)
        x = (i - (n - 1) / 2) * SLOT
        seed = zlib.crc32(dates[i].encode())
        wob = np.random.default_rng(seed + 1)
        # Tall stand behind, so that a quiet week in front of a heavy one is still seen.
        y = 58 + heft ** 1.2 * 108 + wob.uniform(-9, 9)
        c.tower(seed, x + wob.uniform(-1.6, 1.6), y, h, heft, record=v == peak)
    c.back_town(city_rng, width)
    c.street_blocks(city_rng, width, shore_y)
    shore = shore_y
    c.waterfront(city_rng, width, shore)
    # Two stations on the bank, with their stacks in the air whatever the weeks did.
    c.plant(city_rng, -width * .30, shore + 30, 4)
    c.plant(city_rng, width * .36, shore + 44, 3)

    tile_stems = {'f18': 'Facade018A/Facade018A_1K-JPG', 'f19': 'Facade019A/Facade019A_1K-JPG', 'f20': 'Facade020A/Facade020A_1K-JPG'}
    mats = {k: pbr(k, s, tex) for k, s in tile_stems.items()}
    mats['stone'] = plain('stone', .82, 'Concrete034/Concrete034_1K-JPG', tex)
    mats['tar'] = plain('tar', .55)
    mats['timber'] = plain('timber', .85)
    faces = 0
    for k, m in c.m.items():
        to_object(k, m, mats[k])
        faces += len(m.f)

    # River.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -6000 + shore, -.6))
    river = bpy.context.object
    river.scale = (40000, 12000 - 4, 1)
    river.data.materials.append(water_material())
    # Haze-side of the town: the ground runs on to the horizon.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, shore + 6000, -.15))
    land = bpy.context.object
    land.scale = (40000, 12000, 1)
    land.data.materials.append(plain('land', .9))
    land.data.color_attributes.new('tint', 'FLOAT_COLOR', 'CORNER').data.foreach_set('color', np.tile(np.array(grey(.2), np.float32), 4))

    # ---- light --------------------------------------------------------------------------------
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    sc.world = world
    wn = world.node_tree
    env = wn.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(str(Path(a.sky).absolute()))
    mp = wn.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, math.radians(a.sky_rot))
    tc = wn.nodes.new('ShaderNodeTexCoord')
    wn.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    wn.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    bg = wn.nodes['Background']
    bg.inputs['Strength'].default_value = a.sky_gain
    wn.links.new(env.outputs['Color'], bg.inputs['Color'])

    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = a.sun
    sun_data.angle = math.radians(1.2)
    sun = bpy.data.objects.new('sun', sun_data)
    sc.collection.objects.link(sun)
    sun_dir = Vector((-.62, -.66, .42)).normalized()  # over the left shoulder, far enough round to rake the fronts
    sun.rotation_euler = (-sun_dir).to_track_quat('-Z', 'Y').to_euler()

    # ---- a large-format camera on a dock ------------------------------------------------------
    cam_data = bpy.data.cameras.new('press')
    dist = 34 - cam_y
    frame_w = width * 1.03
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.sensor_width = 36
    cam_data.lens = 36 * dist / frame_w
    cam_data.shift_y = (.5 - horizon_from_bottom) / aspect
    cam_data.clip_end = 60000
    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = dist
    cam_data.dof.aperture_fstop = 16
    cam = bpy.data.objects.new('press', cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, cam_y, 16)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    # ---- Cycles -------------------------------------------------------------------------------
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    if a.device == 'gpu':
        pr = bpy.context.preferences.addons['cycles'].preferences
        pr.compute_device_type = 'OPTIX'
        pr.refresh_devices()
        for d in pr.devices:
            d.use = d.type == 'OPTIX'
        cy.device = 'GPU'
    else:
        cy.device = 'CPU'
    if a.threads:
        sc.render.threads_mode = 'FIXED'
        sc.render.threads = a.threads
    cy.samples = a.samples
    cy.seed = 1944
    cy.use_adaptive_sampling = False
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 5
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 0
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_indirect = 6
    sc.render.resolution_x, sc.render.resolution_y = a.width, a.height
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    st = sc.render.image_settings
    st.file_format = 'OPEN_EXR'
    st.color_mode = 'RGB'
    st.color_depth = '32'
    st.exr_codec = 'ZIP'
    sc.render.use_file_extension = False

    print(f'faces {faces}, lens {cam_data.lens:.1f} mm, peak {peak}, tallest {tallest:.0f} m', flush=True)
    # Where each stack lands in the frame, for press.py to hang its smoke on.
    fx = cam_data.lens / 36 * a.width
    plumes = []
    for x, y, z, rad in c.stacks:
        d = y - cam_y
        plumes.append({'x': a.width / 2 + fx * x / d, 'y': a.height * (1 - horizon_from_bottom) - fx * (z - 16) / d, 'depth': math.hypot(d, x), 'r': fx * rad / d})
    Path(str(out) + '_plumes.json').write_text(json.dumps(plumes), encoding='utf8')
    sc.render.filepath = str(out) + '_beauty.exr'
    bpy.ops.render.render(write_still=True)

    # Depth, as a separate quick pass: photo.py lays the haze from it.
    dm = bpy.data.materials.new('depth')
    dm.use_nodes = True
    nt = dm.node_tree
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    e = nt.nodes.new('ShaderNodeEmission')
    camd = nt.nodes.new('ShaderNodeCameraData')
    div = nt.nodes.new('ShaderNodeMath')
    div.operation = 'DIVIDE'
    div.inputs[0].default_value = 1000
    nt.links.new(camd.outputs['View Distance'], div.inputs[1])
    nt.links.new(div.outputs[0], e.inputs['Strength'])
    nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
    sc.view_layers[0].material_override = dm
    wn.links.remove(bg.inputs['Color'].links[0])
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    cy.samples = 8
    cy.use_denoising = False
    cy.max_bounces = 0
    cam_data.dof.use_dof = False
    sc.render.filepath = str(out) + '_depth.exr'
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
