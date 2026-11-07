"""Develops the city's raw render into a press photograph: panchromatic film, smog, smoke.

Everything here is seeded, so the same render always gives the same picture.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import OpenEXR


def _exr(path):
    with OpenEXR.File(str(path)) as f:
        return f.channels()['RGB'].pixels


def _blur(a, s):
    return cv2.GaussianBlur(a, (0, 0), float(s), borderType=cv2.BORDER_REFLECT)


def _noise(rng, h, w, sigmas, weights=None):
    out = np.zeros((h, w), np.float32)
    weights = weights or [1.0] * len(sigmas)
    for s, g in zip(sigmas, weights):
        k = max(1, int(s / 3))
        n = rng.standard_normal((h // k + 8, w // k + 8)).astype(np.float32)
        n = _blur(n, s / k)
        n = (n - n.mean()) / (n.std() + 1e-6)
        out += g * cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
    return (out - out.mean()) / (out.std() + 1e-6)


def _smoke(plumes, depth, rng, u):
    """Density of every plume, depth-tested against the town. One wind leans them all.

    Each plume is a line of puffs that widen and thin with age. Peak density along the line
    is set directly, so a wide old puff never reads darker than the young column it came from.
    """
    h, w = depth.shape
    H2, W2 = h // 2, w // 2
    sigmas = [1.5, 3, 6, 12, 24, 48]
    dens = np.zeros((h, w), np.float32)
    for pl in plumes:
        r0 = max(pl['r'], 1.0)
        size = np.clip(r0 / (5 * u), .35, 1)  # a tug's funnel makes less smoke than a station
        reach = rng.uniform(250, 400) * u * size
        lift = rng.uniform(70, 125) * u * size
        layers = [np.zeros((H2, W2), np.float32) for _ in sigmas]
        ds = 1.5
        for k in range(int(reach / ds)):
            t = k * ds / reach
            ix, iy = int(pl['x'] / 2 + reach * t ** 1.1), int(pl['y'] / 2 - lift * (1 - np.exp(-t * 3)))
            if not (0 <= ix < W2 and 0 <= iy < H2):
                continue
            sig = (r0 * .35 + 40 * u * size * t ** .9) / u
            pos = np.clip(np.log2(max(sig, 1.5) / 1.5), 0, 4.999)
            b0 = int(pos)
            f = pos - b0
            peak = 1.5 * (1 - t) ** 1.25
            mass = peak * ds * 2.507 * sig * u
            layers[b0][iy, ix] += mass * (1 - f)
            layers[b0 + 1][iy, ix] += mass * f
        d = np.zeros((H2, W2), np.float32)
        for lay, s in zip(layers, sigmas):
            if lay.any():
                d += _blur(lay, s * u)
        d = cv2.resize(d, (w, h), interpolation=cv2.INTER_LINEAR)
        dens += np.where(depth > pl['depth'] - 8, d, 0).astype(np.float32)
    # Eddies: large ones bend the column, small ones fray it.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for sg, amp in (([70 * u, 26 * u], 15 * u), ([11 * u, 5 * u], 5 * u)):
        bx = _noise(rng, h, w, sg, [1, .5]) * amp
        by = _noise(rng, h, w, sg, [1, .5]) * amp
        dens = cv2.remap(dens, xx + bx, yy + by, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    return dens * np.clip(1 + _noise(rng, h, w, [14 * u, 5 * u], [1, .6]) * .5, 0, 2)


def _river(H, row, rng, u):
    """Breaks the render's mirror into water: rows of ripple that thicken toward the lens."""
    h, w = H.shape
    r0 = int(row)
    n = h - r0
    if n < 8:
        return H
    T = 260
    def ripples(sx):
        a = rng.standard_normal((T, w)).astype(np.float32)
        a = cv2.GaussianBlur(a, (0, 0), sigmaX=float(sx * u), sigmaY=.8, borderType=cv2.BORDER_REFLECT)
        return (a - a.mean()) / (a.std() + 1e-6)
    yy = np.arange(n, dtype=np.float32)
    fall = yy / (n - 1)
    # Equal steps on the water are ever thicker rows on the film.
    t = np.log1p(yy / (.035 * h)) / np.log1p((n - 1) / (.035 * h)) * (T - 1)
    rows = t.astype(np.int32)
    src = H[r0:]
    smear = cv2.GaussianBlur(src, (0, 0), sigmaX=float(u), sigmaY=float(20 * u), borderType=cv2.BORDER_REFLECT)
    k = (.3 + .6 * fall)[:, None]
    mixed = src * (1 - k) + smear * k
    Y, X = np.mgrid[0:n, 0:w].astype(np.float32)
    dx = ripples(34)[rows] * ((3 + 15 * fall)[:, None] * u)
    dy = ripples(60)[rows] * ((1.5 + 13 * fall)[:, None] * u)
    out = cv2.remap(mixed, X + dx, Y + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    glint = ripples(70)[rows] * .6 + ripples(18)[rows] * .4
    out = out * (1 + glint * (.05 + .16 * fall)[:, None])
    ramp = np.clip(yy / (10 * u), 0, 1)[:, None]
    H = H.copy()
    H[r0:] = src * (1 - ramp) + out * ramp
    return H


def develop(stem, seed=1944, smog=760.0, ground=.26, horizon=.85):
    """Returns tone 0..1, 1 = paper white, from <stem>_beauty.exr and <stem>_depth.exr."""
    rng = np.random.default_rng(seed)
    beauty = _exr(f'{stem}_beauty.exr')
    inv = _exr(f'{stem}_depth.exr')[..., 0]
    h, w = inv.shape
    u = w / 1800
    # Panchromatic film of the day: a little blind in the blue, so skies print with weight.
    L = (beauty * np.array([.36, .56, .08], np.float32)).sum(2)
    depth = 1000 / np.maximum(inv, 1e-4)
    sky = inv < .02
    L = L * (.34 / np.median(L[sky]))

    # Smog thickens with distance and toward the street, and it all fades to one air colour.
    fog = float(np.percentile(L[sky], 42)) * .96
    row = horizon * h
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
    # Measured from the bank, not the water at the lens: the river is air the town stands behind.
    near = np.percentile(depth[~sky & (yy < row)], 3)
    run = np.maximum(depth - near, 0)
    height = np.clip((row - yy) / h, 0, 1)
    low = np.exp(-height / .15)
    t = np.exp(-(run + 28) / smog) * (1 - low * ground * np.clip(run / 90 + .25, 0, 1))
    H = L * t + fog * (1 - t)
    # The sky pales down to the horizon; the far water takes the same air.
    fade = np.clip((yy / h - .22) / .63, 0, 1) ** 1.25 * .72
    H = np.where(sky, L * (1 - fade) + fog * fade, H)
    below = yy > row
    fw = np.exp(-(yy - row) / (h * .05))
    H = np.where(below & ~sky, H * (1 - fw * .5) + fog * .92 * fw * .5, H)
    H = _river(H, row, rng, u)

    # Smoke hangs in that air: lit from the sun side, darker where it is thick.
    plumes_file = Path(f'{stem}_plumes.json')
    if plumes_file.exists():
        d = _smoke(json.loads(plumes_file.read_text(encoding='utf8')), depth, rng, u)
        a = 1 - np.exp(-d)
        # Thick smoke is dark against the sky; it pales to the air colour as it thins out.
        smoke = fog * (.6 + .36 * np.exp(-d * .9) + _noise(rng, h, w, [40 * u]) * .03)
        H = H * (1 - a) + smoke * a

    # An uncoated lens flares a little around anything bright, and lifts the blacks.
    H = H + _blur(np.clip(H - .45, 0, None), 22 * u) * .22 + _blur(H, 90 * u) * .03

    # Film shoulder and toe, then the hard grade a wire photo gets to survive a coarse screen.
    g = 1 - np.exp(-np.clip(H, 0, None) * 1.75)
    g = np.clip(g, 0, 1) ** (1 / 2.0)
    g = np.clip((g - .10) / .84, 0, 1)
    g = g + (.5 - np.abs(g - .5)) * (g - .5) * .72

    # A copy negative is never pin sharp, and it falls away toward the corners.
    yn, xn = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xn / w - .5) / .72) ** 2 + ((yn / h - .5) / .72) ** 2
    k = np.clip(r2 - .2, 0, 1)
    g = _blur(g, 1.0 * u) * (1 - k) + _blur(g, 2.4 * u) * k
    g = g * (1 - np.clip(r2 - .42, 0, 1) * .36)
    # Clumped silver grain, strongest in the mid tones.
    grain = _noise(rng, h, w, [.9 * u, 1.9 * u], [1, .8])
    g = g + grain * .014 * (.35 + (1 - np.abs(g * 2 - 1)))
    return np.clip(g, 0, 1).astype(np.float32)
