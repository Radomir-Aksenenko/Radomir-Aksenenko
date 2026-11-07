"""Prints a page mask on newsprint and photographs it on a table.

Everything is built in page space first (paper, ink, height), so ink and paper
share one displacement field and one light. Only then does the sheet go through
the camera. All noise is seeded: same input, same bytes.

Usage: photo.py <mask.png> <out.jpg> [--layout layout.json] [--width 1800] [--quality 82]
                [--fold 0.5] [--no-fold] [--calm 1] [--margin 0.045] [--seed 1944]
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
TEX = HERE / 'textures'

# Sampled from photographs of real 1944-63 front pages, then pulled toward the
# paler end: gamma-encoded sRGB, 0..1.
PAPER = np.array([0.900, 0.862, 0.752], np.float32)
PAPER_AGED = np.array([0.790, 0.670, 0.480], np.float32)
INK = np.array([0.105, 0.095, 0.080], np.float32)
LIGHT = np.array([-0.46, -0.62, 0.64], np.float32)  # window, upper left
LIGHT /= np.linalg.norm(LIGHT)


def to_linear(c):
    return np.power(np.clip(c, 0, 1), 2.2)


def to_srgb(c):
    return np.power(np.clip(c, 0, 1), 1 / 2.2)


def blur(a, s):
    return cv2.GaussianBlur(a, (0, 0), float(s), borderType=cv2.BORDER_REFLECT)


def norm(a):
    return (a - a.mean()) / (a.std() + 1e-6)


def clouds(rng, h, w, sigmas, weights=None):
    """Band-limited noise, unit variance. Coarse octaves are built small and enlarged."""
    out = np.zeros((h, w), np.float32)
    weights = weights or [1.0] * len(sigmas)
    for s, g in zip(sigmas, weights):
        k = max(1, int(s / 3))
        n = rng.standard_normal((h // k + 8, w // k + 8)).astype(np.float32)
        n = norm(blur(n, s / k))
        out += g * cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
    return norm(out)


def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def tile(img, h, w):
    """Mirror-tile a texture so a large sheet never shows a seam."""
    th, tw = img.shape[:2]
    while th < h or tw < w:
        img = np.concatenate([img, img[::-1]], 0) if th < h else img
        img = np.concatenate([img, img[:, ::-1]], 1) if img.shape[1] < w else img
        th, tw = img.shape[:2]
    return img[:h, :w]


def read_texture(name, flags=cv2.IMREAD_GRAYSCALE):
    data = np.fromfile(str(TEX / name), np.uint8)
    img = cv2.imdecode(data, flags)
    if img is None:
        raise FileNotFoundError(TEX / name)
    return img.astype(np.float32) / 255


def read_mask(path):
    data = np.fromfile(str(path), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img.ndim == 3 and img.shape[2] == 4:  # transparent sheet: alpha holds the ink
        a = img[..., 3].astype(np.float32) / 255
        if a.min() < .99:
            return a
        img = img[..., :3]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255 if img.ndim == 3 else img.astype(np.float32) / 255
    lo, hi = np.percentile(g, .2), np.percentile(g, 99.8)
    return np.clip((hi - g) / max(hi - lo, 1e-3), 0, 1)


def skyline(weeks, h, w, rng):
    """A year of work as a city across a river, continuous tone, 1 = solid ink."""
    horizon = int(h * .79)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Overcast sky: pale at the skyline, heavier and cloudier above.
    sky = .30 - .22 * (yy / horizon)
    cl = clouds(rng, h, w, [w * .10, w * .035, w * .012], [1, .6, .25])
    sky = np.clip(sky + cl * .065 * (1.1 - yy / horizon), .03, .6)
    img = sky.copy()
    # Far, hazy district.
    far = np.abs(clouds(rng, 1, w, [w * .05, w * .012], [1, .5])[0])
    steps = np.repeat(far[::max(1, w // 90)], max(1, w // 90))[:w]
    if steps.size < w:
        steps = np.pad(steps, (0, w - steps.size), mode='edge')
    far_top = horizon - (h * .06 + steps * h * .075)
    img = np.where(yy >= far_top[None, :], .33, img)
    # Nearer blocks between the towers.
    n = len(weeks)
    bw = w / n
    mid = rng.random(n * 2)
    for i, m in enumerate(mid):
        x0, x1 = int(i * bw / 2), int((i + 1.3) * bw / 2)
        top = int(horizon - h * (.03 + m * .09))
        img[top:horizon, x0:x1] = .50 + m * .08
    # One building per week. Tall ones stand behind, so the low ones overlap them.
    peak = max(max(weeks), 1)
    max_h = horizon * .80
    # Solid low city, so no tower stands alone on the bank.
    base_top = horizon - h * .055 - np.abs(clouds(rng, 1, w, [w * .02, w * .006], [1, .5])[0]) * h * .03
    img = np.where((yy >= base_top[None, :]) & (yy < horizon), .74, img)
    order = sorted(range(n), key=lambda i: -weeks[i])
    for i in order:
        v = weeks[i]
        hgt = (h * .05 + np.sqrt(v / peak) * max_h) if v else h * .035
        cx = (i + .5) * bw
        tw = bw * (1.75 + rng.random() * .55)
        if hgt > h * .42:
            tiers = [(1.0, .46), (.72, .76), (.44, .93), (.22, 1.0)]
        elif hgt > h * .2:
            tiers = [(1.0, .68), (.64, 1.0)]
        else:
            tiers = [(1.0, 1.0)]
        for wf, hf in tiers:
            half = tw * wf / 2
            x0, x1 = max(int(cx - half), 0), min(int(np.ceil(cx + half)), w)
            y0 = int(horizon - hgt * hf)
            if x1 <= x0 or y0 >= horizon:
                continue
            split = x0 + int((x1 - x0) * .55)
            hh = horizon - y0
            depth = np.linspace(0, 1, hh, dtype=np.float32)[:, None]
            # Haze lifts the far top of each block; the street end goes dark.
            lit = .34 + depth * .34
            dark = .74 + depth * .20
            pitch_x, pitch_y = max(4, int(bw / 2.6)), max(5, int(bw / 2.3))
            col = np.arange(x0, x1)
            row = np.arange(y0, horizon)
            win = (np.mod(col, pitch_x) < pitch_x * .5)[None, :] & (np.mod(row, pitch_y) < pitch_y * .5)[:, None]
            face = np.where(col[None, :] < split, lit, dark) * np.ones((hh, x1 - x0), np.float32)
            noise = rng.random((hh // pitch_y + 2, (x1 - x0) // pitch_x + 2)).astype(np.float32)
            nmap = noise[(row - y0)[:, None] // pitch_y, (col - x0)[None, :] // pitch_x]
            win_tone = np.where(col[None, :] < split, np.where(nmap > .25, .12, -.05), np.where(nmap > .9, -.42, .03))
            img[y0:horizon, x0:x1] = np.clip(face + win * win_tone, 0, 1)
        # The record week carries a mast.
        if v == peak:
            mx = int(cx)
            img[max(0, int(horizon - hgt * 1.10)):int(horizon - hgt), mx - 1:mx + 2] = .88
    # River: the city's reflection, broken by ripples, with a dark far bank.
    water_h = h - horizon
    refl = img[horizon - water_h * 2:horizon][::-1]
    refl = cv2.resize(blur(refl, 3), (w, water_h), interpolation=cv2.INTER_AREA)
    ry, rx = np.mgrid[0:water_h, 0:w].astype(np.float32)
    ripple = clouds(rng, water_h, w, [1.6, 5], [1, .8])
    streak = cv2.resize(rng.standard_normal((water_h // 3 + 2, w // 60 + 2)).astype(np.float32), (w, water_h), interpolation=cv2.INTER_LINEAR)
    refl = cv2.remap(refl, rx + (ripple * .35 + streak * .65) * (3 + ry * .09), ry, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    refl = blur(refl, 1.6)
    fade = (ry / water_h)
    img[horizon:] = np.clip(refl * (.72 - fade * .34) + .10 + fade * .10 + np.abs(streak) * .03, 0, 1)
    img[horizon - 2:horizon + 2] = .90
    # Lens softness, then the grain of the original negative.
    img = blur(img, 1.15)
    img = img + clouds(rng, h, w, [1.1, 2.4], [1, .7]) * .018
    # A vignette from the wirephoto's copy stand.
    r2 = ((xx / w - .5) / .72) ** 2 + ((yy / h - .5) / .72) ** 2
    return np.clip(img + np.clip(r2 - .55, 0, 1) * .10, 0, 1)


def halftone(tone, pitch, angle=45):
    """An AM screen. Rank-mapping the spot function makes coverage equal tone."""
    h, w = tone.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.deg2rad(angle)
    u = (xx * np.cos(t) + yy * np.sin(t)) * 2 * np.pi / pitch
    v = (-xx * np.sin(t) + yy * np.cos(t)) * 2 * np.pi / pitch
    spot = (np.cos(u) + np.cos(v)) / 2
    grid = np.linspace(0, 2 * np.pi, 256, endpoint=False, dtype=np.float32)
    sample = np.sort(((np.cos(grid)[None, :] + np.cos(grid)[:, None]) / 2).ravel())
    rank = np.interp(spot, sample, np.linspace(1, 0, sample.size)).astype(np.float32)
    return smooth(tone - rank, -.07, .07)


def print_ink(mask, tooth, rng, fold_y, folds_x):
    """Ink as a press leaves it: spread, rough edges, uneven density, gaps in the solids."""
    h, w = mask.shape
    # Edges follow the fibre of the sheet.
    jx = clouds(rng, h, w, [1.1, 2.6], [1, .8]) * .34
    jy = clouds(rng, h, w, [1.1, 2.6], [1, .8]) * .34
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rough = cv2.remap(mask, xx + jx, yy + jy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    # Dot gain: soften, then bias the threshold outward.
    soft = blur(rough, .62)
    a = smooth(soft + tooth * .012, .16, .56)
    # Pressure varies across the forme: broad clouds and slug-height bands.
    broad = clouds(rng, h, w, [120, 420], [.6, 1])
    bands = cv2.resize(blur(rng.standard_normal((h // 9, 1)).astype(np.float32), 1.0), (w, h), interpolation=cv2.INTER_LINEAR)
    bands = norm(bands)
    d = .95 + broad * .03 + bands * .012
    # Solids starve: paper tooth breaks through wherever ink sits thick.
    core = blur(a, 3.5)
    salt = smooth(tooth + clouds(rng, h, w, [1.4]) * .35, 1.25, 2.3)
    # Only real solids starve; a stem of body type is too thin to.
    d = d * (1 - smooth(core, .6, .95) * salt * .30)
    # Rim of a letterpress impression, a touch darker than its middle.
    rim = np.clip(blur(a, 1.2) - blur(a, 3.0), 0, 1)
    d = np.clip(d + rim * .06, 0, 1)
    # Ink cracked off along the folds, in broken flakes.
    gate = np.zeros((h, w), np.float32)
    for y in fold_y:
        gate[max(0, int(y) - 4):int(y) + 4, :] = 1
    for x, _ in folds_x:
        gate[:, max(0, int(x) - 4):int(x) + 4] = np.maximum(gate[:, max(0, int(x) - 4):int(x) + 4], .55)
    gate = blur(gate, 2.0)
    flakes = smooth(clouds(rng, h, w, [1.6, 4.5, 16], [1, 1, .7]), .55, 1.25)
    d = d * (1 - gate * flakes * .7)
    return a * d


def build_height(rng, h, w, fold_y, folds_x, waves, calm=1.0):
    """Sheet height in pixels. Sets one lighting and one warp."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    H = clouds(rng, h, w, [w * .22, w * .08], [1, .34]) * w * .0036
    H += cv2.resize(waves, (w, h), interpolation=cv2.INTER_CUBIC) * w * .0009
    # A sheet that was folded never fully lies back down: a shallow tent on each crease.
    for y in fold_y:
        dy = np.abs(yy - y)
        H += np.exp(-dy / (w * .10)) * w * .0072
        H += np.exp(-(dy / (w * .0012)) ** 2) * w * .00085
        # A crease wanders: paper never folds along a ruled line.
    for x, s in folds_x:
        dx = np.abs(xx - x)
        H += s * np.exp(-dx / (w * .07)) * w * .0052
        H += s * np.exp(-(dx / (w * .001)) ** 2) * w * .00045
    # Edges and corners lift a little.
    ex = np.minimum(xx, w - 1 - xx) / w
    ey = np.minimum(yy, h - 1 - yy) / w
    H += np.exp(-ex / .022) * w * .0042 + np.exp(-ey / .022) * w * .0034
    corner = np.exp(-(ex + ey) / .05)
    H += corner * w * .0095
    return H * calm


def shade(H, tooth, grain_amp=.07):
    fine = H + tooth * grain_amp
    gx = cv2.Sobel(fine, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(fine, cv2.CV_32F, 0, 1, ksize=3) / 8
    nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
    lit = np.clip((-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) * nz, 0, 1.4)
    return .22 + .78 * lit / LIGHT[2]


def page_outline(rng, h, w, fold_y, calm=1.0):
    """Alpha of a trimmed, handled sheet: slightly uneven trim, tiny nicks, torn fold ends."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    drift = clouds(rng, h, w, [240, 40, 5], [1, .22, .10]) * w * .00042 * calm
    d = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) - w * .0035 + drift
    for y in fold_y:
        # Fold ends tear first: a small notch at each margin.
        for side in (0, w - 1):
            r = np.hypot((xx - side) / (w * .0055), (yy - y) / (w * .0021))
            d -= np.exp(-r * r) * w * .0065
    nick = smooth(clouds(rng, h, w, [2.4, 7]), 1.75, 2.5) * np.exp(-np.clip(d, 0, None) / 3)
    d -= nick * 5
    return smooth(d, -.9, .9)


def age(rng, h, w, fold_y, folds_x):
    """0 = fresh sheet, 1 = deep brown. Air browns edges and creases first."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / w
    n = clouds(rng, h, w, [w * .12, w * .03, w * .008], [1, .55, .22])
    a = np.exp(-np.clip(edge - n * .004, 0, None) / .021) * .80
    for y in fold_y:
        a += np.exp(-np.abs(yy - y) / (w * .012)) * .22 * smooth(n, -1.2, .8)
    for x, s in folds_x:
        a += np.exp(-np.abs(xx - x) / (w * .010)) * .10 * s * smooth(n, -1.2, .8)
    a += .08 + clouds(rng, h, w, [w * .2]) * .05
    return np.clip(a, 0, 1)


def sheet(mask, rng, fold_frac, show_from=None, calm=1.0):
    h, w = mask.shape
    # Grain comes off the scanned paper; a second, finer pass closes it down to newsprint.
    grain = read_texture('paper_grain.jpg')
    grain = cv2.resize(tile(grain, int(h * 1.5) + 2, int(w * 1.5) + 2), (w, h), interpolation=cv2.INTER_AREA)
    tooth = norm(grain - blur(grain, 6))
    tooth = np.clip(tooth * .8 + clouds(rng, h, w, [.9]) * .6, -4, 4)
    fold_y = [h * fold_frac] if fold_frac else []
    folds_x = [(w * .5, .55)] if fold_frac else []
    waves = norm(blur(read_texture('paper_waves.jpg'), 6))

    H = build_height(rng, h, w, fold_y, folds_x, waves, calm)

    # Real paper colour first, then toning.
    colour = read_texture('paper_colour.jpg', cv2.IMREAD_COLOR)[..., ::-1]
    colour = cv2.resize(tile(colour, int(h * 1.5) + 2, int(w * 1.5) + 2), (w, h), interpolation=cv2.INTER_AREA)
    relief = colour / (blur(colour, 26) + 1e-3)
    aged = age(rng, h, w, fold_y, folds_x)[..., None]
    base = to_linear(PAPER) * (1 - aged) + to_linear(PAPER_AGED) * aged
    cloud = clouds(rng, h, w, [14, 40, 110, 320], [.35, .55, .8, 1])[..., None]
    fine = clouds(rng, h, w, [1.3, 3], [1, .6])[..., None]
    # Newsprint browns unevenly, losing blue before it loses anything else.
    stain = clouds(rng, h, w, [w * .16, w * .05], [1, .45])[..., None]
    base = base * (1 + np.clip(stain, -1.5, 2.5) * np.array([-.012, -.028, -.058], np.float32))
    paper = base * (1 + cloud * .030 + fine * .010) * (1 + (relief - 1) * .7)
    # Groundwood flecks.
    fleck = smooth(clouds(rng, h, w, [1.0]), 3.1, 3.9)[..., None]
    paper *= 1 - fleck * .34

    # Show-through: the page on the other side, mirrored and diffused through the sheet.
    # Page two is this forme turned over, so the columns land between the columns.
    if show_from is not None:
        body = mask[int(h * show_from):]
        cols = np.array_split(body, 8, axis=1)
        order = [5, 0, 7, 2, 6, 1, 3, 4]
        page2 = np.concatenate([np.roll(cols[i], (k * 311) % body.shape[0], 0) for k, i in enumerate(order)], 1)
        page2 = cv2.resize(tile(page2, h, page2.shape[1]), (w, h), interpolation=cv2.INTER_AREA)[:, ::-1]
        page2 = blur(np.roll(page2, int(w * .043), 1), w * .00052)
        paper *= (1 - page2[..., None] * .10 * (1 + cloud * .25))

    ink = print_ink(mask, tooth, rng, fold_y, folds_x)[..., None]
    albedo = paper * (1 - ink) + to_linear(INK) * ink
    # Soft dark halo where ink soaked in around type.
    albedo *= 1 - blur(ink[..., 0], 2.2)[..., None] * .05

    lit = shade(H, tooth)[..., None]
    alpha = page_outline(rng, h, w, fold_y, calm)
    img = albedo * lit
    # The crease itself: bright broken fibres on the ridge, shadow just below.
    for y in fold_y:
        yy = np.arange(h, dtype=np.float32)[:, None]
        wander = clouds(rng, 1, w, [90, 14], [1, .4]) * 1.6
        dist = yy - y - wander
        fibre = smooth(clouds(rng, h, w, [1.2, 5], [1, .8]), -.3, 1.2)
        ridge = np.exp(-(dist / 1.5) ** 2) * fibre
        under = np.exp(-(np.clip(dist - 1.5, 0, None) / 3.5) ** 2) * (dist > 1.5)
        img = img * (1 - under[..., None] * .13) + ridge[..., None] * .10
    return img, H, alpha


def table(rng, h, w):
    wood = read_texture('wood.jpg', cv2.IMREAD_COLOR)[..., ::-1]
    wood = cv2.resize(tile(wood, h, w), (w, h), interpolation=cv2.INTER_CUBIC)
    lin = to_linear(wood)
    g = cv2.cvtColor(wood, cv2.COLOR_RGB2GRAY)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=5) / 40
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=5) / 40
    relief = np.clip(1 - (gx * LIGHT[0] + gy * LIGHT[1]) * 3.0, .5, 1.5)
    return lin * relief[..., None] * .20


def photograph(img, H, alpha, frame_w, margin, rng, supersample=2, calm=1.0):
    h, w = alpha.shape
    # Parallax from the sheet's relief, in page space.
    slow = blur(H, w * .006)
    gx = cv2.Sobel(slow, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(slow, cv2.CV_32F, 0, 1, ksize=3) / 8
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    k = w * .0052
    # The sheet never lies flat: long slow waves walk the baselines up and down.
    wx = clouds(rng, h, w, [w * .13, w * .045], [1, .3]) * w * .0017 * calm
    wy = clouds(rng, h, w, [w * .13, w * .045], [1, .3]) * w * .0026 * calm
    mapx, mapy = xx + gx * k + wx, yy + gy * k + wy
    img = cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    alpha = cv2.remap(alpha, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    H = cv2.remap(H, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    F = frame_w * supersample
    pw = F * (1 - 2 * margin)
    ph = pw * h / w
    mx, my = F * margin, F * margin * 1.05
    FH = int(ph + 2 * my)
    # A hand-held camera: a degree of tilt, a hair of roll.
    tilt, roll = .010, -.0055
    cx, cy = F / 2, FH / 2
    corners = np.float32([[mx, my], [mx + pw, my], [mx + pw, my + ph], [mx, my + ph]])
    corners[:, 0] += (corners[:, 1] - cy) * roll
    corners[:, 1] -= (corners[:, 0] - cx) * roll
    corners[:, 0] = cx + (corners[:, 0] - cx) * (1 + (corners[:, 1] - cy) / FH * tilt * 2)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, corners)
    size = (F, FH)
    sheet_img = cv2.warpPerspective(img, M, size, flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    a = cv2.warpPerspective(alpha, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    lift = cv2.warpPerspective(H, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) / w

    bg = table(rng, FH, F)
    # One light: shadows fall away from the window, wider where the sheet stands off the table.
    off = np.array([-LIGHT[0], -LIGHT[1]]) / LIGHT[2]
    def cast(dist, soft, strength):
        T = np.float32([[1, 0, off[0] * dist], [0, 1, off[1] * dist]])
        return cv2.warpAffine(blur(a, soft), T, size, borderMode=cv2.BORDER_CONSTANT) * strength
    u = F / 2000
    contact = cast(4 * u, 3 * u, .62)
    near = cast(12 * u, 12 * u, .55)
    far = cast(30 * u, 40 * u, .42)
    # Sum of independent occluders; not a straight add, or it clips to a black outline.
    shadow = 1 - (1 - contact) * (1 - near) * (1 - far)
    bg = bg * (1 - shadow[..., None])
    # The rest of the section lies under the front page, never quite square to it.
    under = np.zeros_like(a)
    under_col = np.zeros_like(bg)
    for dx, dy, rot, shade_k in ((6.5, 7.0, .0013, .58), (-2.5, 5.5, -.0007, .66), (4.5, 3.5, .0009, .74)):
        T = cv2.getRotationMatrix2D((F / 2, FH / 2), float(np.rad2deg(rot)), 1)
        T[0, 2] += dx * u
        T[1, 2] += dy * u
        li = cv2.warpAffine(a, T, size, borderMode=cv2.BORDER_CONSTANT)
        under_col = under_col * (1 - li[..., None]) + to_linear(PAPER_AGED) * shade_k * li[..., None]
        under = np.maximum(under, li)
    bg = bg * (1 - under[..., None]) + under_col * under[..., None]
    # A hairline of shadow where the front page rests on them.
    bg = bg * (1 - cast(1.6 * u, 1.4 * u, .46)[..., None] * under[..., None])
    out = sheet_img * a[..., None] + bg * (1 - a[..., None])

    # Light falls off from the window across the whole scene.
    yy, xx = np.mgrid[0:FH, 0:F].astype(np.float32)
    nx, ny = xx / F, yy / FH
    fall = 1.10 - .24 * (nx * .55 + ny * .45)
    # Vignette of the lens, with its centre pushed toward the light.
    r2 = ((nx - .46) / .78) ** 2 + ((ny - .46) / .82) ** 2
    out = out * (fall * (1 - .22 * np.clip(r2, 0, 1.6) ** 1.3))[..., None]

    # Depth of field: focused mid-frame, slipping at top and bottom.
    far_blur = blur(out, 1.5 * u)
    dof = smooth(np.abs(ny - .47) + (np.abs(nx - .5) * .25), .30, .56)[..., None]
    out = out * (1 - dof * .5) + far_blur * dof * .5

    # Lateral chromatic aberration: red and blue scale apart a hair toward the corners.
    def scale_channel(ch, s):
        T = np.float32([[s, 0, (1 - s) * F / 2], [0, s, (1 - s) * FH / 2]])
        return cv2.warpAffine(ch, T, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    out[..., 0] = scale_channel(out[..., 0], 1.00042)
    out[..., 2] = scale_channel(out[..., 2], .99958)

    # Down to delivery size; the sensor and its pipeline happen after this.
    small = cv2.resize(out, (frame_w, int(FH / supersample)), interpolation=cv2.INTER_AREA)
    # Warm white balance, gentle exposure.
    small = small * np.array([1.03, 1.0, .93], np.float32) * 1.22
    # Sensor noise lives in the linear signal, and shadows carry more of it.
    fh, fw = small.shape[:2]
    lum = small.mean(2, keepdims=True)
    noise = np.stack([clouds(rng, fh, fw, [.55, 1.05], [1, .55]) for _ in range(3)], 2)
    mono = clouds(rng, fh, fw, [.6, 1.2], [1, .6])[..., None]
    small = small + (noise * .35 + mono * .65) * (.0045 + .012 * np.sqrt(np.clip(lum, 0, 1)))
    srgb = to_srgb(small)
    # Film-like shoulder and toe.
    srgb = np.clip(srgb, 0, 1)
    srgb = srgb + (.5 - np.abs(srgb - .5)) * (srgb - .5) * .26
    # A camera's light capture sharpening.
    srgb = srgb + (srgb - blur(srgb, 1.1)) * .42
    return np.clip(srgb, 0, 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mask')
    p.add_argument('out')
    p.add_argument('--layout')
    p.add_argument('--width', type=int, default=1800)
    p.add_argument('--quality', type=int, default=82)
    p.add_argument('--fold', type=float, default=.5)
    p.add_argument('--margin', type=float, default=.045)
    p.add_argument('--seed', type=int, default=1944)
    p.add_argument('--no-fold', action='store_true')
    p.add_argument('--calm', type=float, default=1.0)
    a = p.parse_args()
    rng = np.random.default_rng(a.seed)
    mask = read_mask(a.mask)
    show = None
    if a.layout:
        lay = json.loads(Path(a.layout).read_text(encoding='utf8'))
        k = mask.shape[1] / lay['width']
        show = lay.get('bodyFrom')
        r = lay['picture']
        x, y, w, h = [int(round(r[n] * k)) for n in 'xywh']
        tone = skyline(lay['weeks'], h, w, rng)
        # Screen pitch set so the dots resolve in the delivered photograph.
        pitch = mask.shape[1] / (a.width * (1 - 2 * a.margin)) * 3.7
        mask[y:y + h, x:x + w] = np.maximum(mask[y:y + h, x:x + w], halftone(tone * .96, pitch))
    img, H, alpha = sheet(mask, rng, 0 if a.no_fold else a.fold, show, a.calm)
    shot = photograph(img, H, alpha, a.width, a.margin, rng, calm=a.calm)
    bgr = (shot[..., ::-1] * 255 + .5).astype(np.uint8)
    ok, buf = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, a.quality, cv2.IMWRITE_JPEG_OPTIMIZE, 1, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
    if not ok:
        raise RuntimeError('encode failed')
    Path(a.out).write_bytes(buf.tobytes())
    print(a.out, bgr.shape[1], 'x', bgr.shape[0], f'{len(buf) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
