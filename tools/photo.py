"""Prints a page mask on newsprint and photographs it on a table.

Everything is built in page space first (paper, ink, height), so ink and paper
share one displacement field and one light. Only then does the sheet go through
the camera. All noise is seeded: same input, same bytes.

The result is a cut-out with its shadow in the alpha channel, so it lies directly on the
GitHub page in either theme: there is no table and no rectangle.

Usage: photo.py <mask.png> <out.webp> [--layout layout.json --city <render stem>] [--width 1800]
                [--quality 80] [--fold 0.5] [--no-fold] [--calm 1] [--margin 0.05] [--roll -.5]
                [--seed 1944]
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
PAPER = np.array([0.872, 0.846, 0.772], np.float32)
PAPER_AGED = np.array([0.770, 0.695, 0.555], np.float32)
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


def photograph(img, H, alpha, frame_w, margin, rng, supersample=2, calm=1.0, roll=-.5):
    """Returns sRGB and alpha. Colour runs past the sheet, so filters never pull in a dark rim."""
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
    # Laid down by hand: a little out of square. Hand-held camera: a degree of tilt.
    tilt, rad = .010, np.deg2rad(roll)
    cx, cy = F / 2, FH / 2
    corners = np.float32([[mx, my], [mx + pw, my], [mx + pw, my + ph], [mx, my + ph]])
    dx, dy = corners[:, 0] - cx, corners[:, 1] - cy
    corners[:, 0] = cx + dx * np.cos(rad) - dy * np.sin(rad)
    corners[:, 1] = cy + dx * np.sin(rad) + dy * np.cos(rad)
    corners[:, 0] = cx + (corners[:, 0] - cx) * (1 + (corners[:, 1] - cy) / FH * tilt * 2)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, corners)
    size = (F, FH)
    sheet_img = cv2.warpPerspective(img, M, size, flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    a = cv2.warpPerspective(alpha, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    lift = cv2.warpPerspective(H, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) / w
    u = F / 2000

    # The rest of the section lies under the front page, never quite square to it.
    colour = sheet_img.copy()
    cover = a.copy()
    for ox, oy, rot, shade_k in ((4.5, 3.5, .0009, .86), (-2.5, 5.5, -.0007, .78), (6.5, 7.0, .0013, .70)):
        T = cv2.getRotationMatrix2D((F / 2, FH / 2), float(np.rad2deg(rot)), 1)
        T[0, 2] += ox * u
        T[1, 2] += oy * u
        li = cv2.warpAffine(a, T, size, borderMode=cv2.BORDER_CONSTANT)
        fresh = li * (1 - cover)
        colour = colour * (1 - fresh[..., None]) + to_linear(PAPER_AGED) * shade_k * fresh[..., None]
        cover = np.maximum(cover, li)

    # One light: the shadow grows where the sheet stands off the page, along the fold and at the corners.
    off = np.array([-LIGHT[0], -LIGHT[1]]) / LIGHT[2]
    yy, xx = np.mgrid[0:FH, 0:F].astype(np.float32)
    height = np.clip(blur(lift, 30 * u) * F, 0, None)
    def cast(dist, soft, strength, raise_k):
        d = dist * u + height * raise_k
        return cv2.remap(blur(cover, soft * u), xx - off[0] * d, yy - off[1] * d, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT) * strength
    contact = cast(2.2, 2.2, .62, .18)
    near = cast(7, 9, .44, .6)
    far = cast(16, 30, .30, 1.1)
    shadow = 1 - (1 - contact) * (1 - near) * (1 - far)

    # Light falls off from the window across the whole sheet.
    nx, ny = xx / F, yy / FH
    fall = 1.10 - .22 * (nx * .55 + ny * .45)
    r2 = ((nx - .46) / .78) ** 2 + ((ny - .46) / .82) ** 2
    out = colour * (fall * (1 - .18 * np.clip(r2, 0, 1.6) ** 1.3))[..., None]

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
    dsize = (frame_w, int(FH / supersample))
    small = cv2.resize(out, dsize, interpolation=cv2.INTER_AREA)
    cover_s = cv2.resize(cover, dsize, interpolation=cv2.INTER_AREA)
    shadow_s = cv2.resize(shadow, dsize, interpolation=cv2.INTER_AREA)
    small = small * np.array([1.03, 1.0, .95], np.float32) * 1.2
    fh, fw = small.shape[:2]
    lum = small.mean(2, keepdims=True)
    noise = np.stack([clouds(rng, fh, fw, [.55, 1.05], [1, .55]) for _ in range(3)], 2)
    mono = clouds(rng, fh, fw, [.6, 1.2], [1, .6])[..., None]
    small = small + (noise * .35 + mono * .65) * (.0045 + .012 * np.sqrt(np.clip(lum, 0, 1)))
    srgb = np.clip(to_srgb(small), 0, 1)
    srgb = srgb + (.5 - np.abs(srgb - .5)) * (srgb - .5) * .26
    srgb = srgb + (srgb - blur(srgb, 1.1)) * .42
    srgb = np.clip(srgb, 0, 1)

    # Paper over shadow over whatever the page is: shadow is pure black with its own alpha.
    A = cover_s + (1 - cover_s) * shadow_s
    rgb = srgb * (cover_s / np.maximum(A, 1e-4))[..., None]
    return np.clip(rgb, 0, 1), np.clip(A, 0, 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mask')
    p.add_argument('out')
    p.add_argument('--layout')
    p.add_argument('--city', help='stem of the rendered city, for the picture on the page')
    p.add_argument('--width', type=int, default=1800)
    p.add_argument('--quality', type=int, default=80)
    p.add_argument('--fold', type=float, default=.5)
    p.add_argument('--margin', type=float, default=.05)
    p.add_argument('--seed', type=int, default=1944)
    p.add_argument('--no-fold', action='store_true')
    p.add_argument('--calm', type=float, default=1.0)
    p.add_argument('--roll', type=float, default=-.5)
    p.add_argument('--pitch', type=float, default=3.0, help='halftone pitch in delivered pixels')
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
        from press import develop
        tone = 1 - develop(a.city, seed=a.seed)
        tone = cv2.resize(tone, (w, h), interpolation=cv2.INTER_AREA if tone.shape[1] > w else cv2.INTER_CUBIC)
        # Screen pitch set so the dots just resolve in the delivered photograph.
        pitch = mask.shape[1] / (a.width * (1 - 2 * a.margin)) * a.pitch
        mask[y:y + h, x:x + w] = np.maximum(mask[y:y + h, x:x + w], halftone(tone * .96, pitch))
    img, H, alpha = sheet(mask, rng, 0 if a.no_fold else a.fold, show, a.calm)
    rgb, cut = photograph(img, H, alpha, a.width, a.margin, rng, calm=a.calm, roll=a.roll)
    bgra = np.dstack([rgb[..., ::-1], cut])
    bgra = (bgra * 255 + .5).astype(np.uint8)
    ok, buf = cv2.imencode('.webp', bgra, [cv2.IMWRITE_WEBP_QUALITY, a.quality])
    if not ok:
        raise RuntimeError('encode failed')
    Path(a.out).write_bytes(buf.tobytes())
    print(a.out, bgra.shape[1], 'x', bgra.shape[0], f'{len(buf) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
