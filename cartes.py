"""
Extrait des flashcards recto-verso d'un PDF en WebP (par défaut) séquentiels + manifest.json.

Nouveautés :
- Sélection interactive du PDF dans un répertoire (par défaut: dossier "flashcards" à côté du script).
- Dossier de sortie = nom du PDF (sans extension) créé dans ce même dossier.
- Nettoyage des "fines lignes blanches" via inspection au milieu des côtés.
- Option de fond transparent : supprime TOUT le blanc EXTERNE (coins arrondis compris)
  en conservant le blanc INTERNE de la carte (flood-fill depuis les bords).
- Génération d'un manifest.json qui tague chaque carte (front/back partage les mêmes tags) :
  * Couleur de bordure (vert, orange, rouge, violet) détectée au milieu du bord supérieur.
  * Couleur du timer (vert, jaune, orange, rouge) détectée autour de la position ~ (1100, 725)
    en coordonnées origine en bas-gauche pour une carte de référence 1177×813.
    Les cartes violettes n'ont pas de timer (timer = none).

Exemples :
    python cartes.py
    python cartes.py --no-transparent
    python cartes.py --search-dir /chemin/vers/mes_pdfs --white-threshold 245 --barrier-dilate 1

Dépendances :
    pip install pymupdf pillow numpy
"""

import argparse
import os
import sys
import json
import colorsys
from datetime import datetime, timezone
from typing import Tuple, Optional, Dict, Any, List

import numpy as np
from PIL import Image
import fitz  # PyMuPDF


def fail(msg: str, code: int = 1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def render_page_to_image(page: fitz.Page, dpi: int = 300) -> Image.Image:
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    mode = "RGB" if pix.alpha == 0 else "RGBA"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def to_rgb_white_bg(img: Image.Image) -> Image.Image:
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def crop_to_one_px_margin(img: Image.Image, white_threshold: int = 245, edge_tolerance: float = 0.01) -> Image.Image:
    img = to_rgb_white_bg(img)
    arr = np.asarray(img, dtype=np.uint8)
    y = (0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]).astype(np.float32)

    nonwhite = y < white_threshold
    coords = np.argwhere(nonwhite)
    if coords.size == 0:
        fail("Page appears blank (no non-white content found).")

    (top, left), (bottom, right) = coords.min(0), coords.max(0)
    top = max(0, top - 1)
    left = max(0, left - 1)
    bottom_ex = min(img.height, bottom + 1 + 1)
    right_ex = min(img.width, right + 1 + 1)
    cropped = img.crop((left, top, right_ex, bottom_ex))

    c = np.asarray(cropped, dtype=np.uint8)
    y_c = (0.2126 * c[:, :, 0] + 0.7152 * c[:, :, 1] + 0.0722 * c[:, :, 2]).astype(np.float32)

    def frac_nonwhite_edge(edge_vals: np.ndarray) -> float:
        return float((edge_vals < white_threshold).sum()) / float(edge_vals.size)

    top_bad = frac_nonwhite_edge(y_c[0, :])
    bottom_bad = frac_nonwhite_edge(y_c[-1, :])
    left_bad = frac_nonwhite_edge(y_c[:, 0])
    right_bad = frac_nonwhite_edge(y_c[:, -1])

    if max(top_bad, bottom_bad, left_bad, right_bad) > edge_tolerance:
        fail(
            "Format violation: cannot achieve a uniform ~1px white frame "
            f"(edge non-white fractions: top={top_bad:.3f}, bottom={bottom_bad:.3f}, "
            f"left={left_bad:.3f}, right={right_bad:.3f}). "
            "Try a higher --white-threshold or check page margins."
        )

    return cropped


def split_halves(img: Image.Image) -> Tuple[Image.Image, Image.Image]:
    w, h = img.size
    mid = w // 2
    left = img.crop((0, 0, mid, h))
    right = img.crop((mid, 0, w, h))
    if abs(left.width - right.width) > 1:
        fail(f"Format violation: left/right halves differ too much in width ({left.width}px vs {right.width}px).")
    if left.height != right.height:
        fail("Format violation: left/right halves have different heights.")
    return left, right


def split_rows(side_img: Image.Image, expected_rows: int = 4, tolerance_px: int = 2) -> Tuple[Image.Image, ...]:
    w, h = side_img.size
    base = h / expected_rows
    cuts = [0]
    acc = 0.0
    for _ in range(expected_rows - 1):
        acc += base
        cuts.append(int(round(acc)))
    cuts.append(h)

    rows, heights = [], []
    for i in range(expected_rows):
        top, bottom = cuts[i], cuts[i + 1]
        if bottom <= top:
            fail("Format violation: could not split page side into strictly increasing row bounds.")
        rows.append(side_img.crop((0, top, w, bottom)))
        heights.append(bottom - top)

    if (max(heights) - min(heights)) > tolerance_px:
        fail(
            f"Format violation: row heights vary too much ({heights}); "
            f"max spread {max(heights)-min(heights)}px > {tolerance_px}px. "
        )
    return tuple(rows)


def trim_white_edges_midlines(
    card_img: Image.Image,
    white_threshold: int = 245,
    band_frac: float = 0.10,
    max_trim_frac: float = 0.08,
    white_frac_required: float = 0.98,
) -> Image.Image:
    """Enlève les fines lignes blanches résiduelles en observant les bandes centrales de chaque côté."""
    img = to_rgb_white_bg(card_img)
    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    if h < 5 or w < 5:
        return img

    y = (0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]).astype(np.float32)

    band_h = max(3, int(round(h * band_frac)))
    band_w = max(3, int(round(w * band_frac)))
    r0 = max(0, (h // 2) - (band_h // 2))
    r1 = min(h, r0 + band_h)
    c0 = max(0, (w // 2) - (band_w // 2))
    c1 = min(w, c0 + band_w)

    max_trim_x = max(1, int(round(w * max_trim_frac)))
    max_trim_y = max(1, int(round(h * max_trim_frac)))

    def is_white_col(x: int) -> bool:
        col = y[r0:r1, x]
        return (col >= white_threshold).mean() >= white_frac_required

    def is_white_row(r: int) -> bool:
        row = y[r, c0:c1]
        return (row >= white_threshold).mean() >= white_frac_required

    left_trim = 0
    for x in range(0, min(max_trim_x, w)):
        if is_white_col(x):
            left_trim += 1
        else:
            break
    right_trim = 0
    for dx in range(0, min(max_trim_x, w)):
        x = w - 1 - dx
        if is_white_col(x):
            right_trim += 1
        else:
            break
    top_trim = 0
    for yrow in range(0, min(max_trim_y, h)):
        if is_white_row(yrow):
            top_trim += 1
        else:
            break
    bottom_trim = 0
    for dy in range(0, min(max_trim_y, h)):
        r = h - 1 - dy
        if is_white_row(r):
            bottom_trim += 1
        else:
            break

    left = min(left_trim, w - 2)
    right = max(w - right_trim, left + 1)
    top = min(top_trim, h - 2)
    bottom = max(h - bottom_trim, top + 1)
    if left > 0 or top > 0 or right < w or bottom < h:
        img = img.crop((left, top, right, bottom))
    return img


def _dilate_bool(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Dilatation binaire simple (4-connexité) sans SciPy."""
    out = mask.copy()
    h, w = mask.shape
    for _ in range(max(0, iterations)):
        nb = np.zeros_like(out, dtype=np.uint8)
        nb[:-1, :] |= out[1:, :]
        nb[1:, :] |= out[:-1, :]
        nb[:, :-1] |= out[:, 1:]
        nb[:, 1:] |= out[:, :-1]
        out = (out | nb).astype(bool)
    return out


def make_external_white_transparent(
    card_img: Image.Image,
    white_threshold: int = 245,
    barrier_dilate: int = 1,
) -> Image.Image:
    """
    Met en transparence le blanc EXTERNE à la carte (coins arrondis inclus),
    en conservant le blanc interne.
    Méthode : flood-fill des pixels 'blancs' depuis les bords, bloqué par la bordure colorée.
    - barrier_dilate : renforce la barrière (bordure) de n pixels pour éviter les micro-fuites.
    """
    if card_img.mode != "RGBA":
        img = card_img.convert("RGBA")
    else:
        img = card_img.copy()

    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    if h == 0 or w == 0:
        return img

    y = (0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]).astype(np.float32)
    whiteish = y >= white_threshold

    corner_relax = 5
    corner_thr = max(0, white_threshold - corner_relax)
    corner_px = max(2, min(10, int(round(0.01 * min(h, w)))))
    if corner_px > 0:
        rr, cc = np.ogrid[:h, :w]
        tl = (rr < corner_px) & (cc < corner_px)
        tr = (rr < corner_px) & (cc >= w - corner_px)
        bl = (rr >= h - corner_px) & (cc < corner_px)
        br = (rr >= h - corner_px) & (cc >= w - corner_px)
        corner_mask = tl | tr | bl | br
        whiteish_corner = y >= corner_thr
        whiteish = whiteish | (corner_mask & whiteish_corner)

    barrier = ~whiteish
    if barrier_dilate > 0:
        barrier = _dilate_bool(barrier, iterations=barrier_dilate)

    floodable = whiteish & (~barrier)

    visited = np.zeros((h, w), dtype=bool)
    from collections import deque
    q = deque()

    for x in range(w):
        if floodable[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if floodable[h - 1, x]:
            visited[h - 1, x] = True
            q.append((h - 1, x))
    for yrow in range(h):
        if floodable[yrow, 0]:
            visited[yrow, 0] = True
            q.append((yrow, 0))
        if floodable[yrow, w - 1]:
            visited[yrow, w - 1] = True
            q.append((yrow, w - 1))

    while q:
        r, c = q.popleft()
        if r > 0 and not visited[r - 1, c] and floodable[r - 1, c]:
            visited[r - 1, c] = True
            q.append((r - 1, c))
        if r + 1 < h and not visited[r + 1, c] and floodable[r + 1, c]:
            visited[r + 1, c] = True
            q.append((r + 1, c))
        if c > 0 and not visited[r, c - 1] and floodable[r, c - 1]:
            visited[r, c - 1] = True
            q.append((r, c - 1))
        if c + 1 < w and not visited[r, c + 1] and floodable[r, c + 1]:
            visited[r, c + 1] = True
            q.append((r, c + 1))

    alpha = np.array(img.getchannel("A"), dtype=np.uint8)
    alpha[visited] = 0
    out = img.copy()
    out.putalpha(Image.fromarray(alpha))
    return out


# ------------------------------
# Détection couleurs (bordure & timer)
# ------------------------------

ColorName = str

BORDER_CANDIDATES: Dict[ColorName, float] = {
    "red": 0.0,
    "orange": 30.0,
    "green": 120.0,
    "purple": 285.0,
}

TIMER_CANDIDATES: Dict[ColorName, float] = {
    "red": 0.0,
    "orange": 33.0,
    "yellow": 54.0,
    "green": 120.0,
}


def _hue_distance(a: float, b: float) -> float:
    d = abs(a - b)
    return min(d, 360.0 - d)


def _rgb_to_hsv_deg(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    r, g, b = rgb
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    return h * 360.0, s, v


def _classify_hsv(h: float, s: float, v: float, candidates: Dict[ColorName, float]) -> ColorName:
    # Si très peu saturé ou très sombre, on ne sait pas
    if s < 0.15 or v < 0.15:
        return "unknown"
    # Choix par proximité d'angle de teinte
    best = min(candidates.items(), key=lambda kv: _hue_distance(h, kv[1]))
    name, ref_h = best
    # Tolérance : si trop loin, on bascule en unknown
    if _hue_distance(h, ref_h) > 35.0:  # tolérance généreuse
        return "unknown"
    return name


def _median_rgb(pixels: np.ndarray) -> Optional[Tuple[int, int, int]]:
    if pixels.size == 0:
        return None
    # pixels shape: (N, 3)
    r = int(np.median(pixels[:, 0]))
    g = int(np.median(pixels[:, 1]))
    b = int(np.median(pixels[:, 2]))
    return (r, g, b)


def sample_border_color(
    card_img: Image.Image,
    offset_px: int = 6,
    band_px: int = 6,
    half_width_px: int = 2,
) -> Optional[Tuple[int, int, int]]:
    """Échantillonne la couleur de la bordure en haut de la carte.

    Plus robuste que le simple prélèvement à `offset_px`: on scanne une petite
    fenêtre verticale au-dessus du contenu pour capter une bordure fine ou des
    teintes peu saturées (vert clair, violet). On sélectionne les pixels les plus
    saturés dans cette fenêtre puis on prend la médiane de leurs RGB.

    Ignore les pixels entièrement transparents si présents.
    """
    if card_img.mode not in ("RGB", "RGBA"):
        img = card_img.convert("RGBA")
    else:
        img = card_img

    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    if h == 0 or w == 0:
        return None

    cx = w // 2
    # Petite fenêtre de scan en profondeur: au moins (offset+band), sinon ~24px
    scan_depth = min(h, max(offset_px + band_px, 24))
    x0 = max(0, cx - max(half_width_px, 2))
    x1 = min(w, cx + max(half_width_px, 2) + 1)
    y0 = 0
    y1 = scan_depth

    region = arr[y0:y1, x0:x1, :]
    if region.size == 0:
        return None

    if img.mode == "RGBA":
        alpha = region[:, :, 3].astype(np.uint16)
        alpha_mask = alpha >= 200
        rgb_region = region[:, :, :3]
    else:
        alpha_mask = np.ones(region.shape[:2], dtype=bool)
        rgb_region = region

    # Calcule saturation approx et valeur (V) pour filtrer le blanc/gris
    r = rgb_region[:, :, 0].astype(np.float32)
    g = rgb_region[:, :, 1].astype(np.float32)
    b = rgb_region[:, :, 2].astype(np.float32)
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(maxc > 0, (maxc - minc) / maxc, 0.0)
    v = maxc / 255.0

    color_mask = (s >= 0.12) & (v >= 0.18)
    mask = alpha_mask & color_mask

    if not np.any(mask):
        # Fallback: utilise l'ancienne méthode à offset pour ne pas échouer
        y0f = min(max(0, offset_px), h - 1)
        y1f = min(h, y0f + max(1, band_px))
        region2 = arr[y0f:y1f, x0:x1, :]
        if img.mode == "RGBA":
            alpha2 = region2[:, :, 3]
            mask2 = alpha2 >= 200
            rgb2 = region2[:, :, :3][mask2]
        else:
            rgb2 = region2.reshape(-1, 3)
        return _median_rgb(rgb2.reshape(-1, 3)) if rgb2.size else None

    # Prend les pixels les plus saturés (top 15% ou au moins 20)
    s_flat = s[mask].ravel()
    rgb_flat = rgb_region[mask].reshape(-1, 3)
    if s_flat.size == 0:
        return None
    k = max(20, int(0.15 * s_flat.size))
    if k >= s_flat.size:
        top_rgb = rgb_flat
    else:
        idx = np.argpartition(s_flat, -k)[-k:]
        top_rgb = rgb_flat[idx]

    return _median_rgb(top_rgb)


def classify_border_color(rgb: Optional[Tuple[int, int, int]]) -> ColorName:
    if rgb is None:
        return "unknown"
    h, s, v = _rgb_to_hsv_deg(rgb)
    name = _classify_hsv(h, s, v, BORDER_CANDIDATES)
    if name != "unknown":
        return name
    # Fallback heuristique pour bordures peu saturées mais visuellement dominantes
    r, g, b = rgb
    mx = max(r, g, b)
    if g >= 95 and g >= 1.18 * max(r, b):
        return "green"
    # Purple ~ mélange RB fort, G faible
    if min(r, b) >= 95 and min(r, b) >= 1.15 * g:
        return "purple"
    return "unknown"


def sample_timer_color(
    card_img: Image.Image,
    timer_x_abs: int = 1100,
    timer_y_abs_from_bottom: int = 725,
    ref_w: int = 1177,
    ref_h: int = 813,
    radius: int = 10,
) -> Optional[Tuple[int, int, int]]:
    """Échantillonne la couleur autour du centre du timer.
    - timer_x_abs, timer_y_abs_from_bottom : coordonnées absolues pour l'image de référence ref_w×ref_h
      (origine en bas-gauche). Pour une autre taille, on applique un scaling proportionnel.
    - radius : taille de la fenêtre carrée de sampling (2r+1)^2.
    Ignore les pixels entièrement transparents si présents.
    """
    if card_img.mode not in ("RGB", "RGBA"):
        img = card_img.convert("RGBA")
    else:
        img = card_img

    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    if h == 0 or w == 0:
        return None

    # Mise à l'échelle des coordonnées
    tx = int(round((timer_x_abs / float(ref_w)) * w))
    ty_bottom = int(round((timer_y_abs_from_bottom / float(ref_h)) * h))
    ty = h - 1 - ty_bottom  # conversion origine haut-gauche

    x0 = max(0, tx - radius)
    x1 = min(w, tx + radius + 1)
    y0 = max(0, ty - radius)
    y1 = min(h, ty + radius + 1)

    region = arr[y0:y1, x0:x1, :]
    if img.mode == "RGBA":
        alpha = region[:, :, 3]
        mask = alpha >= 200
        rgb = region[:, :, :3][mask]
    else:
        rgb = region.reshape(-1, 3)

    return _median_rgb(rgb.reshape(-1, 3)) if rgb.size else None


def classify_timer_color(rgb: Optional[Tuple[int, int, int]]) -> ColorName:
    if rgb is None:
        return "unknown"
    h, s, v = _rgb_to_hsv_deg(rgb)
    # Low saturation/value -> no reliable timer detected
    if s < 0.15 or v < 0.18:
        return "unknown"
    # Empirical hue bands from sampled timer colours
    if 75.0 <= h <= 160.0:
        return "green"
    if 45.0 <= h < 75.0:
        return "yellow"
    if 25.0 <= h < 45.0:
        return "orange"
    if h < 25.0 or h >= 340.0:
        return "red"
    return _classify_hsv(h, s, v, TIMER_CANDIDATES)


def ask_user_to_choose_pdf(search_dir: str) -> List[str]:
    try:
        entries = os.listdir(search_dir)
    except Exception as e:
        fail(f"Impossible de lister le répertoire '{search_dir}': {e}")

    pdfs = sorted([f for f in entries if f.lower().endswith(".pdf")])
    if not pdfs:
        fail(f"Aucun fichier .pdf trouvé dans : {os.path.abspath(search_dir)}")

    print("\nPDFs disponibles :")
    print("  [0] Tous les PDFs")
    for i, name in enumerate(pdfs, 1):
        print(f"  [{i}] {name}")

    while True:
        choice = input("\nEntrez le numéro du PDF ([0] pour tous, 'q' pour quitter) : ").strip()
        if choice.lower() in {"q", "quit", "exit"}:
            fail("Annulé par l'utilisateur.", code=0)
        if not choice.isdigit():
            print("Veuillez entrer un numéro valide.")
            continue
        idx = int(choice)
        if idx == 0:
            print("Sélection : tous les PDFs.")
            return [
                os.path.abspath(os.path.join(search_dir, name))
                for name in pdfs
            ]
        if 1 <= idx <= len(pdfs):
            selected = pdfs[idx - 1]
            in_path = os.path.abspath(os.path.join(search_dir, selected))
            print(f"Sélectionné : {selected}")
            return [in_path]
        else:
            print(f"Veuillez entrer un nombre entre 0 et {len(pdfs)}.")


def process_pdf(in_path: str, args: argparse.Namespace) -> None:
    base_name = os.path.splitext(os.path.basename(in_path))[0]
    out_dir = os.path.join(os.path.dirname(in_path), base_name)
    if os.path.exists(out_dir) and not os.path.isdir(out_dir):
        fail(f"Le chemin de sortie existe et n'est pas un dossier : {out_dir}")
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = fitz.open(in_path)
    except Exception as e:
        fail(f"Cannot open PDF: {e}")
    if doc.page_count == 0:
        fail("Empty PDF: no pages.")

    print(f"\n=== Traitement de : {in_path} ===")
    print(f"Dossier de sortie : {out_dir}")
    print(f"Pages : {doc.page_count} | DPI : {args.dpi} | white-threshold : {args.white_threshold}")
    if args.output_format == "webp":
        print(
            "Transparent: {} | barrier-dilate: {} | format: webp (lossless: {}, quality: {}, method: {})".format(
                args.transparent, args.barrier_dilate, args.webp_lossless, args.webp_quality, args.webp_method
            )
        )
    else:
        print(
            "Transparent: {} | barrier-dilate: {} | format: png".format(
                args.transparent, args.barrier_dilate
            )
        )

    cards_by_border = {"green": [], "orange": [], "red": [], "purple": [], "unknown": []}
    cards_by_timer = {"green": [], "yellow": [], "orange": [], "red": [], "none": [], "unknown": []}
    per_card: Dict[str, Dict[str, Any]] = {}

    seq_index = 1
    total_fronts = total_backs = 0
    ext = args.output_format
    canonical_front_size: Optional[Tuple[int, int]] = None
    canonical_back_size: Optional[Tuple[int, int]] = None
    front_size_consistent = True
    back_size_consistent = True

    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        print(f"Processing page {pno + 1}/{doc.page_count}...")
        base_fronts = total_fronts
        base_backs = total_backs

        img = render_page_to_image(page, dpi=args.dpi)
        cropped = crop_to_one_px_margin(img, white_threshold=args.white_threshold)
        left_half, right_half = split_halves(cropped)

        if left_half.height != right_half.height:
            fail("Format violation: left/right halves have different heights after cropping.")

        left_rows = split_rows(left_half, expected_rows=4)  # fronts
        right_rows = split_rows(right_half, expected_rows=4)  # backs

        for row_idx in range(4):
            front_img = left_rows[row_idx]
            back_img = right_rows[row_idx]

            front_img = trim_white_edges_midlines(
                front_img,
                white_threshold=args.white_threshold,
                band_frac=args.band_frac,
                max_trim_frac=args.max_trim_frac,
                white_frac_required=args.white_frac_required,
            )
            back_img = trim_white_edges_midlines(
                back_img,
                white_threshold=args.white_threshold,
                band_frac=args.band_frac,
                max_trim_frac=args.max_trim_frac,
                white_frac_required=args.white_frac_required,
            )

            if args.transparent:
                front_img = make_external_white_transparent(
                    front_img, white_threshold=args.white_threshold, barrier_dilate=args.barrier_dilate
                )
                back_img = make_external_white_transparent(
                    back_img, white_threshold=args.white_threshold, barrier_dilate=args.barrier_dilate
                )
            else:
                if front_img.mode != "RGB":
                    front_img = front_img.convert("RGB")
                if back_img.mode != "RGB":
                    back_img = back_img.convert("RGB")

            border_rgb = sample_border_color(
                front_img, offset_px=args.border_offset, band_px=args.border_band, half_width_px=2
            )
            border_color = classify_border_color(border_rgb)

            if border_color == "purple":
                timer_color: ColorName = "none"
            else:
                timer_rgb = sample_timer_color(
                    front_img,
                    timer_x_abs=args.timer_x,
                    timer_y_abs_from_bottom=args.timer_y,
                    ref_w=args.timer_ref_w,
                    ref_h=args.timer_ref_h,
                    radius=args.timer_radius,
                )
                timer_color = classify_timer_color(timer_rgb)

            front_name = os.path.join(out_dir, f"front{seq_index}.{ext}")
            back_name = os.path.join(out_dir, f"back{seq_index}.{ext}")

            if ext == "webp":
                save_kwargs = {"format": "WEBP", "method": args.webp_method}
                if args.webp_lossless:
                    save_kwargs["lossless"] = True
                else:
                    save_kwargs["quality"] = args.webp_quality
            else:
                save_kwargs = {"format": "PNG", "optimize": True}

            front_img.save(front_name, **save_kwargs)
            back_img.save(back_name, **save_kwargs)

            total_fronts += 1
            total_backs += 1
            print(
                f"  Saved front{seq_index}.{ext} & back{seq_index}.{ext} | border={border_color} | timer={timer_color}"
            )

            num = seq_index
            cards_by_border.get(border_color, cards_by_border["unknown"]).append(num)
            cards_by_timer.get(timer_color, cards_by_timer["unknown"]).append(num)
            front_size = (front_img.width, front_img.height)
            back_size = (back_img.width, back_img.height)
            if canonical_front_size is None:
                canonical_front_size = front_size
            elif canonical_front_size != front_size:
                front_size_consistent = False
            if canonical_back_size is None:
                canonical_back_size = back_size
            elif canonical_back_size != back_size:
                back_size_consistent = False

            per_card[str(num)] = {
                "border": border_color,
                "timer": timer_color,
                "front": {"width": front_img.width, "height": front_img.height},
                "back": {"width": back_img.width, "height": back_img.height},
            }

            seq_index += 1

        if total_fronts - base_fronts != 4 or total_backs - base_backs != 4:
            fail("Internal error: did not produce exactly 4 fronts and 4 backs for this page.")

    manifest: Dict[str, Any] = {
        "chapter": base_name,
        "asset_version": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "image_format": ext,
        "total_cards": total_fronts,
        "cards_by_border": {k: sorted(v) for k, v in cards_by_border.items() if v},
        "cards_by_timer": {k: sorted(v) for k, v in cards_by_timer.items() if v},
        "per_card": per_card,
    }
    if front_size_consistent and canonical_front_size is not None:
        manifest["card_dimensions"] = manifest.get("card_dimensions", {})
        manifest["card_dimensions"]["front"] = {
            "width": canonical_front_size[0],
            "height": canonical_front_size[1],
        }
    if back_size_consistent and canonical_back_size is not None:
        manifest.setdefault("card_dimensions", {})
        manifest["card_dimensions"]["back"] = {
            "width": canonical_back_size[0],
            "height": canonical_back_size[1],
        }
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(
        f"\nDone. Wrote {total_fronts} fronts and {total_backs} backs to: {out_dir}\nManifest: {manifest_path}\n"
    )

def main():
    parser = argparse.ArgumentParser(
        description="Découpe de cartes PDF en images (WebP par défaut, options trim, fond transparent) + manifest.json."
    )
    # Par défaut, chercher dans le dossier 'flashcards' à côté de ce script
    default_search = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flashcards")
    parser.add_argument(
        "--search-dir",
        default=default_search,
        help="Répertoire où chercher les PDFs (défaut: dossier 'flashcards' à côté du script).",
    )
    parser.add_argument("--dpi", type=int, default=300, help="DPI de rendu (défaut 300).")
    parser.add_argument("--white-threshold", type=int, default=220, help="Seuil 0–255 pour 'blanc' (défaut 220).")
    parser.add_argument("--band-frac", type=float, default=0.10, help="Épaisseur de bande centrale (trim) 0–0.5.")
    parser.add_argument("--max-trim-frac", type=float, default=0.08, help="Rognage max par côté (trim) en fraction.")
    parser.add_argument("--white-frac-required", type=float, default=0.98, help="Part de blanc requise (trim).")
    parser.add_argument("--barrier-dilate", type=int, default=1, help="Renforcement de la barrière (dilatation px).")

    # Paramètres de sampling des couleurs
    parser.add_argument("--border-offset", type=int, default=6, help="Décalage depuis le bord haut pour lire la bordure.")
    parser.add_argument("--border-band", type=int, default=6, help="Hauteur de bande pour la bordure.")
    parser.add_argument(
        "--timer-x", type=int, default=1100, help="Coordonnée X (référence) du centre du timer (origine bas-gauche)."
    )
    parser.add_argument(
        "--timer-y", type=int, default=725, help="Coordonnée Y (référence) du centre du timer (origine bas-gauche)."
    )
    parser.add_argument("--timer-ref-w", type=int, default=1177, help="Largeur de référence pour le timer.")
    parser.add_argument("--timer-ref-h", type=int, default=813, help="Hauteur de référence pour le timer.")
    parser.add_argument("--timer-radius", type=int, default=12, help="Rayon de sampling autour du timer.")
    parser.add_argument(
        "--output-format",
        choices=["png", "webp"],
        default="webp",
        help="Format des images de sortie (défaut: webp).",
    )
    parser.add_argument(
        "--webp-quality", type=int, default=88, help="Qualité WebP lossy 0-100 (défaut 88)."
    )
    parser.add_argument(
        "--webp-method", type=int, default=6, help="Effort d'encodage WebP 0-6 (défaut 6 = max)."
    )
    parser.add_argument(
        "--webp-lossless",
        action="store_true",
        help="Active l'encodage WebP lossless (ignore la qualité lossy).",
    )

    g = parser.add_mutually_exclusive_group()
    g.add_argument("--transparent", dest="transparent", action="store_true", help="Active le fond transparent.")
    g.add_argument(
        "--no-transparent", dest="transparent", action="store_false", help="Désactive le fond transparent."
    )
    parser.set_defaults(transparent=True)
    args = parser.parse_args()
    args.output_format = args.output_format.lower()
    if args.output_format == "webp":
        args.webp_quality = max(0, min(100, args.webp_quality))
        args.webp_method = max(0, min(6, args.webp_method))
    else:
        if args.webp_lossless:
            print("Attention: --webp-lossless ignoré car le format de sortie est PNG.")
            args.webp_lossless = False

    selected_paths = ask_user_to_choose_pdf(args.search_dir)

    if len(selected_paths) > 1:
        for idx, in_path in enumerate(selected_paths, start=1):
            print(f"\n--- Lot {idx}/{len(selected_paths)} ---")
            process_pdf(in_path, args)
    else:
        process_pdf(selected_paths[0], args)


if __name__ == "__main__":
    main()
