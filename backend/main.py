import os
import uuid
import shutil
import zipfile
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import piexif
import json

app = FastAPI(title="PhotoIQ")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE       = Path(__file__).parent.parent
UPLOADS    = BASE / "uploads"
EXPORTS    = BASE / "exports"
ORIGINALS  = BASE / "originals"
STATIC     = BASE / "frontend" / "static"
WATERMARK  = STATIC / "img" / "watermark.png"

for d in [UPLOADS, EXPORTS, ORIGINALS]:
    d.mkdir(exist_ok=True)

# ── In-memory photo registry ──────────────────────────────────────────────────
photos: dict[str, dict] = {}


def load_state():
    state_file = BASE / "state.json"
    if state_file.exists():
        global photos
        try:
            photos = json.loads(state_file.read_text())
        except Exception:
            photos = {}

def save_state():
    state_file = BASE / "state.json"
    state_file.write_text(json.dumps(photos, indent=2, default=str))

load_state()


# ── Watermark engine ──────────────────────────────────────────────────────────
def apply_watermark(img: Image.Image, opacity: float = 0.35, scale: float = 0.22, angle: float = 0) -> Image.Image:
    if not WATERMARK.exists():
        return img

    base = img.convert("RGBA")
    wm_orig = Image.open(WATERMARK).convert("RGBA")

    # Scale watermark to % of image width
    wm_w = int(base.width * scale)
    wm_h = int(wm_orig.height * (wm_w / wm_orig.width))
    wm = wm_orig.resize((wm_w, wm_h), Image.LANCZOS)

    # Apply opacity
    r, g, b, a = wm.split()
    a = a.point(lambda x: int(x * opacity))
    wm.putalpha(a)

    # Rotate if needed
    if angle != 0:
        wm = wm.rotate(angle, expand=True)

    # Position: bottom right with small margin
    margin = int(base.width * 0.02)
    x = base.width  - wm.width  - margin
    y = base.height - wm.height - margin

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(wm, (x, y))
    return Image.alpha_composite(base, layer).convert("RGB")


def write_caption_exif(path: Path, caption: str):
    try:
        exif_dict = piexif.load(str(path))
        encoded = caption.encode("utf-8")
        exif_dict["0th"][piexif.ImageIFD.ImageDescription] = encoded
        exif_dict["Exif"][piexif.ExifIFD.UserComment]      = b"ASCII\x00\x00\x00" + encoded
        exif_bytes = piexif.dump(exif_dict)
        piexif.insert(exif_bytes, str(path))
    except Exception:
        pass  # EXIF write is best-effort


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/photos")
def list_photos():
    return list(photos.values())


@app.post("/api/upload")
async def upload_photos(files: list[UploadFile] = File(...)):
    added = []
    for file in files:
        if not file.content_type or not file.content_type.startswith("image/"):
            continue
        photo_id = str(uuid.uuid4())
        ext      = Path(file.filename).suffix.lower() or ".jpg"
        filename = f"{photo_id}{ext}"
        dest     = UPLOADS / filename
        orig     = ORIGINALS / filename

        content = await file.read()
        dest.write_bytes(content)
        orig.write_bytes(content)

        # Generate thumbnail
        try:
            img = Image.open(dest)
            img.thumbnail((400, 400))
            thumb_path = UPLOADS / f"thumb_{filename.replace(ext, '.jpg')}"
            img.convert("RGB").save(thumb_path, "JPEG", quality=80)
            thumb_url = f"/uploads/thumb_{filename.replace(ext, '.jpg')}"
        except Exception:
            thumb_url = f"/uploads/{filename}"

        record = {
            "id":           photo_id,
            "original_name": file.filename,
            "filename":     filename,
            "caption":      "",
            "new_name":     Path(file.filename).stem,
            "url":          f"/uploads/{filename}",
            "thumb_url":    thumb_url,
            "uploaded_at":  datetime.now().isoformat(),
            "size":         len(content),
        }
        photos[photo_id] = record
        added.append(record)

    save_state()
    return added


@app.patch("/api/photos/{photo_id}")
async def update_photo(photo_id: str, caption: Optional[str] = Form(None), new_name: Optional[str] = Form(None)):
    if photo_id not in photos:
        raise HTTPException(404, "Photo not found")
    if caption  is not None: photos[photo_id]["caption"]  = caption
    if new_name is not None: photos[photo_id]["new_name"] = new_name
    save_state()
    return photos[photo_id]


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: str):
    if photo_id not in photos:
        raise HTTPException(404, "Not found")
    rec = photos.pop(photo_id)
    for folder in [UPLOADS, ORIGINALS]:
        p = folder / rec["filename"]
        if p.exists(): p.unlink()
        t = folder / f"thumb_{rec['filename'].rsplit('.', 1)[0]}.jpg"
        if t.exists(): t.unlink()
    save_state()
    return {"deleted": photo_id}


@app.delete("/api/photos")
async def delete_many(body: dict):
    ids = body.get("ids", [])
    for pid in ids:
        if pid in photos:
            rec = photos.pop(pid)
            for folder in [UPLOADS, ORIGINALS]:
                p = folder / rec["filename"]
                if p.exists(): p.unlink()
                t = folder / f"thumb_{rec['filename'].rsplit('.', 1)[0]}.jpg"
                if t.exists(): t.unlink()
    save_state()
    return {"deleted": len(ids)}


@app.post("/api/export")
async def export_photos(body: dict):
    ids         = body.get("ids", [])          # empty = all
    watermark   = body.get("watermark", True)
    wm_opacity  = float(body.get("opacity", 0.35))
    wm_scale    = float(body.get("scale", 0.22))
    wm_angle    = float(body.get("angle", 0))
    prefix      = body.get("prefix", "")
    start_num   = int(body.get("start_num", 1))
    pad         = int(body.get("pad", 4))

    targets = [photos[i] for i in ids if i in photos] if ids else list(photos.values())
    if not targets:
        raise HTTPException(400, "No photos to export")

    export_id  = str(uuid.uuid4())[:8]
    export_dir = EXPORTS / export_id
    export_dir.mkdir()

    for i, rec in enumerate(targets):
        src = ORIGINALS / rec["filename"]
        if not src.exists():
            src = UPLOADS / rec["filename"]
        if not src.exists():
            continue

        img = Image.open(src)

        # Watermark
        if watermark:
            img = apply_watermark(img, opacity=wm_opacity, scale=wm_scale, angle=wm_angle)
        else:
            img = img.convert("RGB")

        # Build output filename
        custom = rec.get("new_name", "").strip()
        if prefix or len(targets) > 1:
            num_str = str(start_num + i).zfill(pad)
            name    = f"{prefix}{num_str}" if prefix else f"{custom or 'photo'}_{num_str}"
        else:
            name = custom or Path(rec["filename"]).stem

        out_path = export_dir / f"{name}.jpg"
        img.save(out_path, "JPEG", quality=95)

        # Write caption to EXIF
        if rec.get("caption"):
            write_caption_exif(out_path, rec["caption"])

    # Zip it
    zip_path = EXPORTS / f"PhotoIQ_export_{export_id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in export_dir.iterdir():
            zf.write(f, f.name)
    shutil.rmtree(export_dir)

    return {"download_url": f"/exports/{zip_path.name}", "count": len(targets)}


# ── Static files ──────────────────────────────────────────────────────────────
app.mount("/uploads",  StaticFiles(directory=str(UPLOADS)),  name="uploads")
app.mount("/exports",  StaticFiles(directory=str(EXPORTS)),  name="exports")
app.mount("/static",   StaticFiles(directory=str(STATIC)),   name="static")

@app.get("/")
def index():
    return FileResponse(str(BASE / "frontend" / "index.html"))
