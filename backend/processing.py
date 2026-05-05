from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps, ImageDraw, ImageFilter


# ── Levels ────────────────────────────────────────────────────────────────────

def apply_levels(img: Image.Image, black_point: int = 0, white_point: int = 255,
                 gamma: float = 1.0) -> Image.Image:
    if black_point == 0 and white_point == 255 and abs(gamma - 1.0) < 0.01:
        return img
    img = img.convert("RGB")
    bp = max(0, min(254, black_point))
    wp = max(bp + 1, min(255, white_point))
    scale = wp - bp

    def map_val(x: int) -> int:
        n = max(0.0, min(1.0, (x - bp) / scale))
        if abs(gamma - 1.0) > 0.01:
            n = n ** (1.0 / gamma)
        return int(n * 255)

    lut = bytes([map_val(i) for i in range(256)] * 3)
    return img.point(lut)


# ── Adjustments ───────────────────────────────────────────────────────────────

def apply_adjustments(img: Image.Image, brightness: float = 0, contrast: float = 0,
                      saturation: float = 0, sharpness: float = 0,
                      black_point: int = 0, white_point: int = 255,
                      gamma: float = 1.0) -> Image.Image:
    img = apply_levels(img, black_point, white_point, gamma)
    if brightness != 0:
        img = ImageEnhance.Brightness(img).enhance(max(0.01, 1 + brightness / 100))
    if contrast != 0:
        img = ImageEnhance.Contrast(img).enhance(max(0.01, 1 + contrast / 100))
    if saturation != 0:
        img = ImageEnhance.Color(img).enhance(max(0.0, 1 + saturation / 100))
    if sharpness != 0:
        img = ImageEnhance.Sharpness(img).enhance(max(0.0, 1 + sharpness / 50))
    return img


# ── Filters ───────────────────────────────────────────────────────────────────

def apply_filter(img: Image.Image, name: str) -> Image.Image:
    img = img.convert("RGB")

    if name == "bw":
        return img.convert("L").convert("RGB")

    if name == "sepia":
        gray = img.convert("L")
        r = gray.point(lambda x: min(255, int(x * 1.1)))
        g = gray.point(lambda x: min(255, int(x * 0.9)))
        b = gray.point(lambda x: min(255, int(x * 0.7)))
        return Image.merge("RGB", [r, g, b])

    if name == "vintage":
        img = ImageEnhance.Color(img).enhance(0.7)
        img = ImageEnhance.Contrast(img).enhance(0.9)
        r, g, b = img.split()
        r = r.point(lambda x: min(255, x + 15))
        b = b.point(lambda x: max(0, x - 20))
        return Image.merge("RGB", [r, g, b])

    if name == "fade":
        img = ImageEnhance.Contrast(img).enhance(0.7)
        return ImageEnhance.Brightness(img).enhance(1.1)

    if name == "vivid":
        img = ImageEnhance.Color(img).enhance(1.6)
        return ImageEnhance.Contrast(img).enhance(1.1)

    if name == "cool":
        r, g, b = img.split()
        r = r.point(lambda x: max(0, x - 15))
        b = b.point(lambda x: min(255, x + 20))
        return Image.merge("RGB", [r, g, b])

    if name == "warm":
        r, g, b = img.split()
        r = r.point(lambda x: min(255, x + 20))
        b = b.point(lambda x: max(0, x - 15))
        return Image.merge("RGB", [r, g, b])

    if name == "vignette":
        w, h = img.size
        mask = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask)
        mx, my = int(w * 0.15), int(h * 0.15)
        draw.ellipse([mx, my, w - mx, h - my], fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(int(min(w, h) * 0.25)))
        return Image.composite(img, Image.new("RGB", (w, h), (0, 0, 0)), mask)

    if name == "chrome":
        img = ImageEnhance.Color(img).enhance(1.4)
        img = ImageEnhance.Contrast(img).enhance(1.2)
        r, g, b = img.split()
        r = r.point(lambda x: max(0, x - 10))
        b = b.point(lambda x: min(255, x + 15))
        return Image.merge("RGB", [r, g, b])

    return img  # "none" or unknown


# ── Watermark ─────────────────────────────────────────────────────────────────

def apply_watermark(img: Image.Image, watermark_path: Path, opacity: float = 0.35,
                    scale: float = 0.22, angle: float = 0) -> Image.Image:
    if not watermark_path.exists():
        return img
    base = img.convert("RGBA")
    wm = Image.open(watermark_path).convert("RGBA")
    wm_w = int(base.width * scale)
    wm_h = int(wm.height * (wm_w / wm.width))
    wm = wm.resize((wm_w, wm_h), Image.LANCZOS)
    r, g, b, a = wm.split()
    wm.putalpha(a.point(lambda x: int(x * opacity)))
    if angle != 0:
        wm = wm.rotate(angle, expand=True)
    margin = int(base.width * 0.02)
    x = base.width - wm.width - margin
    y = base.height - wm.height - margin
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(wm, (x, y))
    return Image.alpha_composite(base, layer).convert("RGB")


# ── Full NDE pipeline ─────────────────────────────────────────────────────────

def apply_edits(img: Image.Image, record: dict, watermark_path: Path) -> Image.Image:
    # 1. EXIF auto-orient
    try:
        import piexif
        exif_bytes = img.info.get("exif", b"")
        if exif_bytes:
            exif = piexif.load(exif_bytes)
            orient = exif.get("0th", {}).get(piexif.ImageIFD.Orientation, 1)
            ops = {2: Image.FLIP_LEFT_RIGHT, 3: Image.ROTATE_180,
                   4: Image.FLIP_TOP_BOTTOM, 5: Image.TRANSPOSE,
                   6: Image.ROTATE_270, 7: Image.TRANSVERSE, 8: Image.ROTATE_90}
            if orient in ops:
                img = img.transpose(ops[orient])
    except Exception:
        pass

    # 2. Crop
    crop = record.get("crop")
    if crop:
        iw, ih = img.size
        x = max(0, min(int(crop["x"]), iw - 1))
        y = max(0, min(int(crop["y"]), ih - 1))
        w = max(1, min(int(crop["w"]), iw - x))
        h = max(1, min(int(crop["h"]), ih - y))
        img = img.crop((x, y, x + w, y + h))

    # 3. Rotate (CW = negative in PIL's CCW convention)
    degrees = record.get("rotate", 0)
    if degrees:
        img = img.rotate(-degrees, expand=True, resample=Image.BICUBIC)

    # 4. Flip
    if record.get("flip_h"):
        img = ImageOps.mirror(img)
    if record.get("flip_v"):
        img = ImageOps.flip(img)

    # 5. Resize
    resize = record.get("resize")
    if resize and resize.get("w") and resize.get("h"):
        img = img.resize((int(resize["w"]), int(resize["h"])), Image.LANCZOS)

    # 6. Filter
    fname = record.get("filter", "none")
    if fname and fname != "none":
        img = apply_filter(img, fname)

    # 7. Adjustments
    adj = record.get("adjustments", {})
    if adj:
        img = img.convert("RGB")
        img = apply_adjustments(img, **{k: adj.get(k, v) for k, v in {
            "brightness": 0, "contrast": 0, "saturation": 0, "sharpness": 0,
            "black_point": 0, "white_point": 255, "gamma": 1.0,
        }.items()})

    # 8. Watermark (opt-in per photo)
    if record.get("watermark_enabled"):
        img = apply_watermark(
            img, watermark_path,
            opacity=float(record.get("wm_opacity", 0.35)),
            scale=float(record.get("wm_scale", 0.22)),
            angle=float(record.get("wm_angle", 0)),
        )

    return img.convert("RGB")


# ── Export format dispatch ────────────────────────────────────────────────────

def save_image(img: Image.Image, path: Path, fmt: str, quality: int = 92) -> Path:
    fmt = fmt.lower()
    if fmt == "png":
        out = path.with_suffix(".png")
        img.save(out, "PNG", optimize=True)
        return out
    if fmt == "webp":
        out = path.with_suffix(".webp")
        img.save(out, "WebP", quality=quality, method=6)
        return out
    if fmt == "svg":
        import base64, io
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality)
        b64 = base64.b64encode(buf.getvalue()).decode()
        w, h = img.size
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
               f'<image href="data:image/jpeg;base64,{b64}" width="{w}" height="{h}"/></svg>')
        out = path.with_suffix(".svg")
        out.write_text(svg)
        return out
    if fmt == "psd":
        out = path.with_suffix(".psd")
        try:
            from psd_tools import PSDImage
            psd = PSDImage.new("RGB", img.size)
            psd.save(str(out))
        except Exception:
            out = path.with_suffix(".tiff")
            img.save(out, "TIFF")
        return out
    # default: jpeg
    out = path.with_suffix(".jpg")
    img.save(out, "JPEG", quality=quality, optimize=True)
    return out
