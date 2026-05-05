import uuid
import shutil
import zipfile
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import piexif
import json

from .processing import apply_edits, save_image

app = FastAPI(title="PhotoIQ")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE      = Path(__file__).parent.parent
UPLOADS   = BASE / "uploads"
EXPORTS   = BASE / "exports"
ORIGINALS = BASE / "originals"
STATIC    = BASE / "frontend" / "static"
WATERMARK = STATIC / "img" / "watermark.png"

for d in [UPLOADS, EXPORTS, ORIGINALS]:
    d.mkdir(exist_ok=True)


# ── Default NDE record ────────────────────────────────────────────────────────

def _default_record(photo_id: str, filename: str, original_name: str,
                    size: int, thumb_url: str) -> dict:
    return {
        "id":            photo_id,
        "original_name": original_name,
        "filename":      filename,
        "new_name":      Path(original_name).stem,
        "caption":       "",
        # NDE transforms
        "rotate":        0,
        "flip_h":        False,
        "flip_v":        False,
        "crop":          None,
        "resize":        None,
        # NDE tone
        "filter":        "none",
        "adjustments": {
            "brightness":  0,
            "contrast":    0,
            "saturation":  0,
            "sharpness":   0,
            "black_point": 0,
            "white_point": 255,
            "gamma":       1.0,
        },
        # Watermark — opt-in per photo
        "watermark_enabled": False,
        "wm_opacity":    0.35,
        "wm_scale":      0.22,
        "wm_angle":      0,
        # Meta
        "url":           f"/uploads/{filename}",
        "thumb_url":     thumb_url,
        "uploaded_at":   datetime.now().isoformat(),
        "size":          size,
    }


# ── Persistence ───────────────────────────────────────────────────────────────

photos: dict[str, dict] = {}


def load_state():
    f = BASE / "state.json"
    if f.exists():
        global photos
        try:
            photos = json.loads(f.read_text())
        except Exception:
            photos = {}


def save_state():
    (BASE / "state.json").write_text(json.dumps(photos, indent=2, default=str))


load_state()


# ── EXIF caption ──────────────────────────────────────────────────────────────

def write_caption_exif(path: Path, caption: str):
    try:
        exif_dict = piexif.load(str(path))
        encoded = caption.encode("utf-8")
        exif_dict["0th"][piexif.ImageIFD.ImageDescription] = encoded
        exif_dict["Exif"][piexif.ExifIFD.UserComment] = b"ASCII\x00\x00\x00" + encoded
        piexif.insert(piexif.dump(exif_dict), str(path))
    except Exception:
        pass


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

        content = await file.read()
        (UPLOADS   / filename).write_bytes(content)
        (ORIGINALS / filename).write_bytes(content)

        try:
            img = Image.open(UPLOADS / filename)
            img.thumbnail((400, 400))
            thumb_name = f"thumb_{photo_id}.jpg"
            img.convert("RGB").save(UPLOADS / thumb_name, "JPEG", quality=80)
            thumb_url = f"/uploads/{thumb_name}"
        except Exception:
            thumb_url = f"/uploads/{filename}"

        rec = _default_record(photo_id, filename, file.filename, len(content), thumb_url)
        photos[photo_id] = rec
        added.append(rec)

    save_state()
    return added


@app.patch("/api/photos/{photo_id}")
async def update_photo(photo_id: str, body: dict):
    if photo_id not in photos:
        raise HTTPException(404, "Photo not found")

    rec = photos[photo_id]
    top_fields = {"caption", "new_name", "rotate", "flip_h", "flip_v",
                  "crop", "resize", "filter", "watermark_enabled",
                  "wm_opacity", "wm_scale", "wm_angle"}
    for key in top_fields:
        if key in body:
            rec[key] = body[key]

    if "adjustments" in body and isinstance(body["adjustments"], dict):
        rec["adjustments"].update(body["adjustments"])

    save_state()
    return rec


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: str):
    if photo_id not in photos:
        raise HTTPException(404, "Not found")
    _remove_files(photos.pop(photo_id))
    save_state()
    return {"deleted": photo_id}


@app.delete("/api/photos")
async def delete_many(body: dict):
    ids = body.get("ids", [])
    for pid in list(ids):
        if pid in photos:
            _remove_files(photos.pop(pid))
    save_state()
    return {"deleted": len(ids)}


def _remove_files(rec: dict):
    for folder in [UPLOADS, ORIGINALS]:
        for name in [rec["filename"], f"thumb_{rec['id']}.jpg"]:
            p = folder / name
            if p.exists():
                p.unlink()


@app.post("/api/export")
async def export_photos(body: dict):
    ids       = body.get("ids", [])
    fmt       = body.get("format", "jpeg").lower()
    quality   = max(1, min(100, int(body.get("quality", 92))))
    prefix    = body.get("prefix", "")
    start_num = int(body.get("start_num", 1))
    pad       = int(body.get("pad", 4))

    targets = [photos[i] for i in ids if i in photos] if ids else list(photos.values())
    if not targets:
        raise HTTPException(400, "No photos to export")

    export_id  = str(uuid.uuid4())[:8]
    export_dir = EXPORTS / export_id
    export_dir.mkdir()

    count = 0
    for i, rec in enumerate(targets):
        src = ORIGINALS / rec["filename"]
        if not src.exists():
            src = UPLOADS / rec["filename"]
        if not src.exists():
            continue

        img = Image.open(src)
        img = apply_edits(img, rec, WATERMARK)

        custom = rec.get("new_name", "").strip()
        if prefix or len(targets) > 1:
            num  = str(start_num + i).zfill(pad)
            stem = f"{prefix}{num}" if prefix else f"{custom or 'photo'}_{num}"
        else:
            stem = custom or Path(rec["filename"]).stem

        out = save_image(img, export_dir / stem, fmt, quality)

        if rec.get("caption"):
            try:
                write_caption_exif(out, rec["caption"])
            except Exception:
                pass
        count += 1

    zip_path = EXPORTS / f"PhotoIQ_export_{export_id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in export_dir.iterdir():
            zf.write(f, f.name)
    shutil.rmtree(export_dir)

    return {"download_url": f"/exports/{zip_path.name}", "count": count}


# ── Static files ──────────────────────────────────────────────────────────────

app.mount("/uploads", StaticFiles(directory=str(UPLOADS)), name="uploads")
app.mount("/exports", StaticFiles(directory=str(EXPORTS)), name="exports")
app.mount("/static",  StaticFiles(directory=str(STATIC)),  name="static")


@app.get("/")
def index():
    return FileResponse(str(BASE / "frontend" / "index.html"))
