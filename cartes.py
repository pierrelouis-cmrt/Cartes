"""
Extracts double-sided flashcards from a PDF into sequential PNGs.

Assumptions / format (strict):
- Each PDF page shows flashcards with a uniform white border around the whole grid.
- Left half = fronts, right half = backs.
- Exactly 4 rows per page, equally tall.
- We first reduce the page to a uniform 1-pixel white margin, then split.

Example:
python cartes.py --input ch1_cartes.pdf --output cropped_cards/

Dependencies (install via pip):
    pip install pymupdf pillow numpy
"""

import argparse
import os
import sys
from typing import Tuple

import numpy as np
from PIL import Image, ImageOps
import fitz  # PyMuPDF


def fail(msg: str, code: int = 1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def render_page_to_image(page: fitz.Page, dpi: int = 300) -> Image.Image:
    """Render a PDF page to a PIL image at the given DPI."""
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)  # opaque background
    mode = "RGB" if pix.alpha == 0 else "RGBA"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def to_rgb_white_bg(img: Image.Image) -> Image.Image:
    """Convert any mode to RGB with a white background (handles alpha)."""
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def crop_to_one_px_margin(img: Image.Image, white_threshold: int = 245, edge_tolerance: float = 0.01) -> Image.Image:
    """
    Crop to the tight content bounds and leave exactly a 1px near-white frame.
    - Color agnostic: uses luminance (grayscale) to detect 'white-ish' background.
    - Noise tolerant: allows up to `edge_tolerance` fraction of edge pixels to be non-white.
    """
    img = to_rgb_white_bg(img)
    arr = np.asarray(img, dtype=np.uint8)

    # Luminance (Rec. 709): robust to any border color
    # y = 0.2126 R + 0.7152 G + 0.0722 B
    y = (0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]).astype(np.float32)

    nonwhite = y < white_threshold  # content wherever luminance dips below threshold
    coords = np.argwhere(nonwhite)
    if coords.size == 0:
        fail("Page appears blank (no non-white content found).")

    (top, left), (bottom, right) = coords.min(0), coords.max(0)

    # Expand by 1px to leave a 1px white frame; clamp to bounds
    top = max(0, top - 1)
    left = max(0, left - 1)
    bottom_ex = min(img.height, bottom + 1 + 1)  # +1 to go exclusive, +1 for 1px frame
    right_ex  = min(img.width,  right  + 1 + 1)

    cropped = img.crop((left, top, right_ex, bottom_ex))

    # Verify outer frame is near-white with a small tolerance for dust/speckles
    c = np.asarray(cropped, dtype=np.uint8)
    y_c = (0.2126 * c[:, :, 0] + 0.7152 * c[:, :, 1] + 0.0722 * c[:, :, 2]).astype(np.float32)

    def frac_nonwhite_edge(edge_vals: np.ndarray) -> float:
        return float((edge_vals < white_threshold).sum()) / float(edge_vals.size)

    top_bad    = frac_nonwhite_edge(y_c[0, :])
    bottom_bad = frac_nonwhite_edge(y_c[-1, :])
    left_bad   = frac_nonwhite_edge(y_c[:, 0])
    right_bad  = frac_nonwhite_edge(y_c[:, -1])

    if max(top_bad, bottom_bad, left_bad, right_bad) > edge_tolerance:
        fail(
            "Format violation: cannot achieve a uniform ~1px white frame "
            f"(edge non-white fractions: top={top_bad:.3f}, bottom={bottom_bad:.3f}, "
            f"left={left_bad:.3f}, right={right_bad:.3f}). "
            "Try a higher --white-threshold or check page margins."
        )

    return cropped


def split_halves(img: Image.Image) -> Tuple[Image.Image, Image.Image]:
    """Split the image vertically into left and right halves. Allow at most 1px width mismatch."""
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
    """
    Split one side into `expected_rows` horizontal slices.
    Accept tiny rounding differences (≤ tolerance_px) between row heights.
    """
    w, h = side_img.size
    base = h / expected_rows

    # Compute cut positions by rounding the running sum so leftover pixels are
    # distributed across rows (not all dumped into the last one).
    cuts = [0]
    acc = 0.0
    for _ in range(expected_rows - 1):
        acc += base
        cuts.append(int(round(acc)))
    cuts.append(h)

    # Build rows and check height spread.
    rows, heights = [], []
    for i in range(expected_rows):
        top, bottom = cuts[i], cuts[i + 1]
        if bottom <= top:
            fail("Format violation: could not split page side into strictly increasing row bounds.")
        rows.append(side_img.crop((0, top, w, bottom)))
        heights.append(bottom - top)

    if (max(heights) - min(heights)) > tolerance_px:
        fail(f"Format violation: row heights vary too much ({heights}); "
             f"max spread {max(heights)-min(heights)}px > {tolerance_px}px. "
             "Check crop/threshold or page format.")

    return tuple(rows)



def main():
    parser = argparse.ArgumentParser(description="Crop flashcard PDF to PNG fronts/backs.")
    parser.add_argument("--input", "-i", required=True, help="Path to input PDF file.")
    parser.add_argument("--output", "-o", required=True, help="Directory to write PNGs.")
    parser.add_argument("--dpi", type=int, default=300, help="Render DPI (default: 300).")
    parser.add_argument("--white-threshold", type=int, default=245,
                        help="0–255 luminance threshold for 'white' (default: 245).")
    args = parser.parse_args()

    in_path = args.input
    out_dir = args.output
    dpi = args.dpi
    white_thr = args.white_threshold

    if not os.path.isfile(in_path):
        fail(f"Input not found: {in_path}")

    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = fitz.open(in_path)
    except Exception as e:
        fail(f"Cannot open PDF: {e}")

    if doc.page_count == 0:
        fail("Empty PDF: no pages.")

    seq_index = 1  # global card-side index (front1/back1, front2/back2, ...)
    total_fronts = total_backs = 0

    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        print(f"Processing page {pno + 1}/{doc.page_count}...")
        base_fronts = total_fronts
        base_backs = total_backs

        img = render_page_to_image(page, dpi=dpi)
        cropped = crop_to_one_px_margin(img, white_threshold=white_thr)
        left_half, right_half = split_halves(cropped)

        # Enforce equal heights across halves and rows
        if left_half.height != right_half.height:
            fail("Format violation: left/right halves have different heights after cropping.")

        # Each half must split into exactly 4 rows
        left_rows = split_rows(left_half, expected_rows=4)   # fronts
        right_rows = split_rows(right_half, expected_rows=4) # backs

        # Save in top-to-bottom order; maintain frontN/backN pairing
        for row_idx in range(4):
            front_img = left_rows[row_idx]
            back_img = right_rows[row_idx]

            front_name = os.path.join(out_dir, f"front{seq_index}.png")
            back_name = os.path.join(out_dir, f"back{seq_index}.png")

            front_img.save(front_name, format="PNG", optimize=True)
            back_img.save(back_name, format="PNG", optimize=True)

            total_fronts += 1
            total_backs += 1
            print(f"  Saved front{seq_index}.png & back{seq_index}.png")
            seq_index += 1

        # Page-level validation: exactly 4 fronts and 4 backs written this page
        if total_fronts - base_fronts != 4 or total_backs - base_backs != 4:
            fail("Internal error: did not produce exactly 4 fronts and 4 backs for this page.")

    print(f"Done. Wrote {total_fronts} fronts and {total_backs} backs to: {out_dir}")


if __name__ == "__main__":
    main()
