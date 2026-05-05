/* PhotoIQ v1.01 */

const API = '';

// ── Constants ─────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'none',    label: 'Original', css: '' },
  { id: 'bw',      label: 'B&W',      css: 'grayscale(1)' },
  { id: 'sepia',   label: 'Sepia',    css: 'sepia(1)' },
  { id: 'vintage', label: 'Vintage',  css: 'sepia(0.35) contrast(0.9) brightness(1.05)' },
  { id: 'fade',    label: 'Fade',     css: 'contrast(0.7) brightness(1.1) saturate(0.8)' },
  { id: 'vivid',   label: 'Vivid',    css: 'saturate(1.6) contrast(1.1)' },
  { id: 'cool',    label: 'Cool',     css: 'hue-rotate(15deg) saturate(1.1) brightness(0.95)' },
  { id: 'warm',    label: 'Warm',     css: 'hue-rotate(-15deg) saturate(1.1) brightness(1.05)' },
  { id: 'vignette',label: 'Vignette', css: 'contrast(1.1) brightness(0.9)' },
  { id: 'chrome',  label: 'Chrome',   css: 'saturate(1.4) contrast(1.2) hue-rotate(10deg)' },
];

const SLIDERS = [
  { id: 'brightness',  label: 'Brightness',  min: -100, max: 100,  step: 1,    def: 0,    css: true  },
  { id: 'contrast',    label: 'Contrast',    min: -100, max: 100,  step: 1,    def: 0,    css: true  },
  { id: 'saturation',  label: 'Saturation',  min: -100, max: 100,  step: 1,    def: 0,    css: true  },
  { id: 'sharpness',   label: 'Sharpness',   min: -100, max: 100,  step: 1,    def: 0,    css: false },
  { id: 'black_point', label: 'Black Point', min: 0,    max: 100,  step: 1,    def: 0,    css: false },
  { id: 'white_point', label: 'White Point', min: 155,  max: 255,  step: 1,    def: 255,  css: false },
  { id: 'gamma',       label: 'Gamma',       min: 0.1,  max: 3.0,  step: 0.05, def: 1.0,  css: false },
];

// ── State ─────────────────────────────────────────────────────────────────────

let photos        = [];
let selected      = new Set();
let lightboxId    = null;
let cropperInst   = null;
let exportFormat  = 'jpeg';
let exportQuality = 92;

function defaultEditState() {
  return {
    rotate: 0, flip_h: false, flip_v: false,
    crop: null, resize: null, filter: 'none',
    watermark_enabled: false, wm_opacity: 0.35, wm_scale: 0.22, wm_angle: 0,
    adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0,
                   black_point: 0, white_point: 255, gamma: 1.0 },
  };
}
let editState = defaultEditState();

// ── Utility ───────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function buildCSSFilter(adj) {
  const b = (1 + adj.brightness / 100).toFixed(2);
  const c = (1 + adj.contrast   / 100).toFixed(2);
  const s = Math.max(0, 1 + adj.saturation / 100).toFixed(2);
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

function applyImagePreview() {
  const img = document.getElementById('lb-image');
  if (!img) return;
  const filterCSS = editState.filter !== 'none'
    ? (FILTERS.find(f => f.id === editState.filter)?.css || '')
    : buildCSSFilter(editState.adjustments);
  let transform = '';
  if (editState.rotate) transform += ` rotate(${editState.rotate}deg)`;
  if (editState.flip_h) transform += ` scaleX(-1)`;
  if (editState.flip_v) transform += ` scaleY(-1)`;
  img.style.filter    = filterCSS;
  img.style.transform = transform.trim();
}

// ── Header / state sync ───────────────────────────────────────────────────────

function updateHeader() {
  document.getElementById('stat-count').textContent =
    `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  const sel    = selected.size;
  const selEl  = document.getElementById('stat-selected');
  const delBtn = document.getElementById('btn-delete-selected');
  if (sel > 0) {
    selEl.textContent  = `${sel} selected`;
    selEl.style.display = '';
    delBtn.style.display = '';
  } else {
    selEl.style.display  = 'none';
    delBtn.style.display = 'none';
  }
  document.getElementById('toolbar').style.display    = photos.length ? '' : 'none';
  document.getElementById('empty-state').style.display = photos.length ? 'none' : '';
}

// ── Inline rename ─────────────────────────────────────────────────────────────

function startInlineRename(photo) {
  const card = document.querySelector(`[data-id="${photo.id}"]`);
  if (!card) return;
  const wrap = card.querySelector('.card-name-wrap');
  const span = wrap.querySelector('.card-name');
  if (wrap.querySelector('.card-name-input')) return; // already editing

  const input = document.createElement('input');
  input.className = 'card-name-input';
  input.value     = photo.new_name || Path_stem(photo.original_name) || '';
  input.type      = 'text';
  wrap.replaceChild(input, span);
  input.focus();
  input.select();

  const commit = async () => {
    const name = input.value.trim() || span.textContent;
    photo.new_name = name;
    span.textContent = name;
    if (wrap.contains(input)) wrap.replaceChild(span, input);
    await fetch(`${API}/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: name }),
    });
    const captionEl = card.querySelector('.card-caption');
    if (captionEl) captionEl.textContent = photo.caption || 'No caption';
  };

  const cancel = () => {
    if (wrap.contains(input)) wrap.replaceChild(span, input);
  };

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      commit().then(() => {
        const cards = [...document.querySelectorAll('.photo-card')];
        const idx   = cards.findIndex(c => c.dataset.id === photo.id);
        if (idx >= 0 && idx < cards.length - 1) {
          const nextId = cards[idx + 1].dataset.id;
          const next   = photos.find(p => p.id === nextId);
          if (next) startInlineRename(next);
        }
      });
    }
  });
}

function Path_stem(filename) {
  if (!filename) return '';
  const base = filename.split('/').pop();
  const dot  = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// ── Card render ───────────────────────────────────────────────────────────────

function renderCard(photo) {
  const card = document.createElement('div');
  card.className = `photo-card${selected.has(photo.id) ? ' selected' : ''}`;
  card.dataset.id = photo.id;

  const name    = photo.new_name || Path_stem(photo.original_name) || photo.filename;
  const caption = photo.caption || '';
  const wmOn    = photo.watermark_enabled;

  card.innerHTML = `
    <div class="card-check">✓</div>
    <div class="card-img-wrap">
      <img class="card-thumb" src="${photo.thumb_url || photo.url}" alt="${name}" loading="lazy" />
      <button class="card-wm-badge${wmOn ? ' active' : ''}" data-action="wm" title="Toggle watermark">◈</button>
    </div>
    <div class="card-body">
      <div class="card-name-wrap">
        <span class="card-name">${name}</span>
      </div>
      <div class="card-caption ${caption ? '' : 'empty'}">${caption || 'No caption'}</div>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-action="edit">Edit</button>
      <button class="card-btn danger" data-action="delete">Delete</button>
    </div>
  `;

  // Selection — click on image/check area only
  const imgWrap = card.querySelector('.card-img-wrap');
  const check   = card.querySelector('.card-check');
  [imgWrap, check].forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    toggleSelect(photo.id);
  }));

  // Inline rename — click the name
  card.querySelector('.card-name-wrap').addEventListener('click', e => {
    e.stopPropagation();
    startInlineRename(photo);
  });

  // Watermark badge toggle
  card.querySelector('[data-action="wm"]').addEventListener('click', async e => {
    e.stopPropagation();
    photo.watermark_enabled = !photo.watermark_enabled;
    const badge = e.currentTarget;
    badge.classList.toggle('active', photo.watermark_enabled);
    await fetch(`${API}/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watermark_enabled: photo.watermark_enabled }),
    });
    toast(photo.watermark_enabled ? 'Watermark on' : 'Watermark off');
  });

  // Double-click anywhere else → lightbox
  card.addEventListener('dblclick', e => {
    if (e.target.closest('.card-name-wrap') || e.target.closest('.card-btn')) return;
    openLightbox(photo.id);
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', e => {
    e.stopPropagation(); openLightbox(photo.id);
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation(); deletePhoto(photo.id);
  });

  return card;
}

function renderAll() {
  const sheet = document.getElementById('contact-sheet');
  sheet.querySelectorAll('.photo-card').forEach(el => el.remove());
  photos.forEach(p => sheet.appendChild(renderCard(p)));
  updateHeader();
}

function updateCard(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  const old = document.querySelector(`[data-id="${id}"]`);
  if (old) old.replaceWith(renderCard(photo));
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) card.classList.toggle('selected', selected.has(id));
  updateHeader();
}

document.getElementById('btn-select-all').addEventListener('click', () => {
  photos.forEach(p => selected.add(p.id));
  renderAll();
});
document.getElementById('btn-deselect').addEventListener('click', () => {
  selected.clear();
  renderAll();
});

// ── Upload ────────────────────────────────────────────────────────────────────

async function uploadFiles(files) {
  if (!files.length) return;
  const bar  = document.getElementById('upload-bar');
  const fill = document.getElementById('upload-bar-fill');
  const lbl  = document.getElementById('upload-bar-label');
  bar.style.display = '';
  fill.style.width  = '0%';

  const CHUNK = 10;
  const total = files.length;
  let done = 0;

  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = Array.from(files).slice(i, i + CHUNK);
    const fd = new FormData();
    chunk.forEach(f => fd.append('files', f));
    try {
      const res  = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      photos.push(...data);
      done += chunk.length;
      fill.style.width  = `${Math.round(done / total * 100)}%`;
      lbl.textContent   = `${done} / ${total} uploaded`;
      renderAll();
    } catch(e) {
      toast('Upload error: ' + e.message, 'error');
    }
  }

  setTimeout(() => { bar.style.display = 'none'; }, 800);
  toast(`${total} photo${total !== 1 ? 's' : ''} uploaded`, 'success');
}

const dz = document.getElementById('dropzone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});
dz.addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', e => {
  uploadFiles(e.target.files); e.target.value = '';
});

// ── Delete ────────────────────────────────────────────────────────────────────

async function deletePhoto(id) {
  if (!confirm('Delete this photo?')) return;
  const res = await fetch(`${API}/api/photos/${id}`, { method: 'DELETE' });
  if (res.ok) {
    photos = photos.filter(p => p.id !== id);
    selected.delete(id);
    document.querySelector(`[data-id="${id}"]`)?.remove();
    updateHeader();
    toast('Photo deleted');
    if (lightboxId === id) closeLightbox();
  }
}

document.getElementById('btn-delete-selected').addEventListener('click', async () => {
  const ids = [...selected];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected photo${ids.length !== 1 ? 's' : ''}?`)) return;
  const res = await fetch(`${API}/api/photos`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (res.ok) {
    photos = photos.filter(p => !ids.includes(p.id));
    ids.forEach(id => selected.delete(id));
    renderAll();
    toast(`${ids.length} photo${ids.length !== 1 ? 's' : ''} deleted`, 'success');
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.lb-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.lb-tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${name}`));
  if (name !== 'transform') destroyCropper();
}

document.querySelectorAll('.lb-tab').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ── Adjust sliders (built once, reused) ──────────────────────────────────────

function buildAdjustSliders() {
  const container = document.getElementById('adjust-sliders');
  if (container.children.length) return; // already built
  SLIDERS.forEach(s => {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `
      <div class="slider-header">
        <span class="lb-label">${s.label}</span>
        <span class="range-val" id="val-${s.id}">${s.def}</span>
      </div>
      <input class="range-input" type="range"
             id="sl-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.def}" />
      ${!s.css ? '<div class="edit-hint" style="margin-top:2px">Server-side only</div>' : ''}
    `;
    container.appendChild(row);

    const input = row.querySelector(`#sl-${s.id}`);
    const valEl = row.querySelector(`#val-${s.id}`);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valEl.textContent = s.id === 'gamma' ? v.toFixed(2) : v;
      editState.adjustments[s.id] = v;
      if (s.css) applyImagePreview();
    });
  });
}

function loadSliderValues() {
  SLIDERS.forEach(s => {
    const el  = document.getElementById(`sl-${s.id}`);
    const val = document.getElementById(`val-${s.id}`);
    if (!el) return;
    const v = editState.adjustments[s.id] ?? s.def;
    el.value      = v;
    val.textContent = s.id === 'gamma' ? parseFloat(v).toFixed(2) : v;
  });
}

document.getElementById('adj-reset').addEventListener('click', () => {
  SLIDERS.forEach(s => { editState.adjustments[s.id] = s.def; });
  loadSliderValues();
  applyImagePreview();
});

// ── Filter strip (built once, reused) ─────────────────────────────────────────

function buildFilterStrip() {
  const strip = document.getElementById('filter-strip');
  if (strip.children.length) return;
  FILTERS.forEach(f => {
    const btn = document.createElement('button');
    btn.className   = 'filter-pill';
    btn.dataset.fid = f.id;
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      editState.filter = f.id;
      strip.querySelectorAll('.filter-pill').forEach(b =>
        b.classList.toggle('active', b.dataset.fid === f.id));
      applyImagePreview();
    });
    strip.appendChild(btn);
  });
}

function loadFilterValue() {
  document.querySelectorAll('.filter-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.fid === editState.filter));
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  lightboxId = id;

  // Populate meta
  document.getElementById('lb-image').src      = photo.url;
  document.getElementById('lb-filename').textContent = photo.original_name || photo.filename;
  document.getElementById('lb-rename').value   = photo.new_name || '';
  document.getElementById('lb-caption').value  = photo.caption  || '';

  // Load NDE state from photo record
  editState = {
    rotate:            photo.rotate            ?? 0,
    flip_h:            photo.flip_h            ?? false,
    flip_v:            photo.flip_v            ?? false,
    crop:              photo.crop              ?? null,
    resize:            photo.resize            ?? null,
    filter:            photo.filter            ?? 'none',
    watermark_enabled: photo.watermark_enabled ?? false,
    wm_opacity:        photo.wm_opacity        ?? 0.35,
    wm_scale:          photo.wm_scale          ?? 0.22,
    wm_angle:          photo.wm_angle          ?? 0,
    adjustments: { ...(photo.adjustments ?? defaultEditState().adjustments) },
  };

  // Watermark controls in Meta tab
  const wmToggle = document.getElementById('lb-wm-toggle');
  wmToggle.checked = editState.watermark_enabled;
  document.getElementById('wm-settings').style.display = editState.watermark_enabled ? '' : 'none';
  document.getElementById('lb-wm-opacity').value = Math.round(editState.wm_opacity * 100);
  document.getElementById('lb-wm-opacity-val').textContent = Math.round(editState.wm_opacity * 100) + '%';
  document.getElementById('lb-wm-scale').value  = Math.round(editState.wm_scale * 100);
  document.getElementById('lb-wm-scale-val').textContent  = Math.round(editState.wm_scale * 100) + '%';
  document.getElementById('lb-wm-angle').value  = String(editState.wm_angle);

  // Transform: rotation display
  document.getElementById('rot-deg').value    = editState.rotate;
  document.getElementById('rot-display').textContent = `Rotation: ${editState.rotate}°`;
  document.getElementById('flip-h').classList.toggle('active', editState.flip_h);
  document.getElementById('flip-v').classList.toggle('active', editState.flip_v);
  document.getElementById('crop-hint').textContent = editState.crop
    ? `Crop: ${editState.crop.w}×${editState.crop.h} px`  : '';
  if (editState.resize) {
    document.getElementById('resize-w').value = editState.resize.w;
    document.getElementById('resize-h').value = editState.resize.h;
  } else {
    document.getElementById('resize-w').value = '';
    document.getElementById('resize-h').value = '';
  }

  buildAdjustSliders();
  loadSliderValues();
  buildFilterStrip();
  loadFilterValue();
  applyImagePreview();

  switchTab('meta');
  document.getElementById('lightbox').style.display = '';
}

function closeLightbox() {
  destroyCropper();
  const img = document.getElementById('lb-image');
  img.style.filter    = '';
  img.style.transform = '';
  document.getElementById('lightbox').style.display = 'none';
  lightboxId = null;
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-backdrop').addEventListener('click', closeLightbox);

// ── Watermark toggle in lightbox ──────────────────────────────────────────────

document.getElementById('lb-wm-toggle').addEventListener('change', e => {
  editState.watermark_enabled = e.target.checked;
  document.getElementById('wm-settings').style.display = e.target.checked ? '' : 'none';
});

['lb-wm-opacity', 'lb-wm-scale'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById(id + '-val').textContent = v + '%';
    if (id === 'lb-wm-opacity') editState.wm_opacity = v / 100;
    if (id === 'lb-wm-scale')   editState.wm_scale   = v / 100;
  });
});

document.getElementById('lb-wm-angle').addEventListener('change', e => {
  editState.wm_angle = parseInt(e.target.value);
});

// ── Transform controls ────────────────────────────────────────────────────────

document.getElementById('rot-ccw').addEventListener('click', () => {
  editState.rotate = ((editState.rotate - 90) % 360 + 360) % 360;
  document.getElementById('rot-deg').value = editState.rotate;
  document.getElementById('rot-display').textContent = `Rotation: ${editState.rotate}°`;
  applyImagePreview();
});
document.getElementById('rot-cw').addEventListener('click', () => {
  editState.rotate = (editState.rotate + 90) % 360;
  document.getElementById('rot-deg').value = editState.rotate;
  document.getElementById('rot-display').textContent = `Rotation: ${editState.rotate}°`;
  applyImagePreview();
});
document.getElementById('rot-180').addEventListener('click', () => {
  editState.rotate = (editState.rotate + 180) % 360;
  document.getElementById('rot-deg').value = editState.rotate;
  document.getElementById('rot-display').textContent = `Rotation: ${editState.rotate}°`;
  applyImagePreview();
});
document.getElementById('rot-apply').addEventListener('click', () => {
  editState.rotate = parseInt(document.getElementById('rot-deg').value) || 0;
  document.getElementById('rot-display').textContent = `Rotation: ${editState.rotate}°`;
  applyImagePreview();
});

document.getElementById('flip-h').addEventListener('click', () => {
  editState.flip_h = !editState.flip_h;
  document.getElementById('flip-h').classList.toggle('active', editState.flip_h);
  applyImagePreview();
});
document.getElementById('flip-v').addEventListener('click', () => {
  editState.flip_v = !editState.flip_v;
  document.getElementById('flip-v').classList.toggle('active', editState.flip_v);
  applyImagePreview();
});

// ── Cropper.js ────────────────────────────────────────────────────────────────

function destroyCropper() {
  if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
  document.getElementById('crop-apply').style.display  = 'none';
  document.getElementById('crop-enable').style.display = '';
}

document.getElementById('crop-enable').addEventListener('click', () => {
  const img = document.getElementById('lb-image');
  cropperInst = new Cropper(img, {
    viewMode: 1, autoCropArea: 0.8,
    movable: false, zoomable: false, rotatable: false, scalable: false,
    responsive: true,
  });
  document.getElementById('crop-enable').style.display = 'none';
  document.getElementById('crop-apply').style.display  = '';
  document.getElementById('crop-hint').textContent = 'Drag to select area, then Apply';
});

document.getElementById('crop-apply').addEventListener('click', () => {
  if (!cropperInst) return;
  const d = cropperInst.getData(true); // true = rounded to integer
  editState.crop = { x: d.x, y: d.y, w: d.width, h: d.height };
  document.getElementById('crop-hint').textContent = `Crop: ${d.width}×${d.height} px`;
  destroyCropper();
});

document.getElementById('crop-clear').addEventListener('click', () => {
  editState.crop = null;
  document.getElementById('crop-hint').textContent = '';
  destroyCropper();
});

// ── Resize ────────────────────────────────────────────────────────────────────

const resizeW    = document.getElementById('resize-w');
const resizeH    = document.getElementById('resize-h');
const resizeLock = document.getElementById('resize-lock');

function getNaturalAspect() {
  const img = document.getElementById('lb-image');
  return img.naturalWidth && img.naturalHeight
    ? img.naturalWidth / img.naturalHeight : 1;
}

resizeW.addEventListener('input', () => {
  const w = parseInt(resizeW.value);
  if (resizeLock.checked && w) {
    resizeH.value = Math.round(w / getNaturalAspect());
  }
  editState.resize = w && parseInt(resizeH.value)
    ? { w, h: parseInt(resizeH.value) } : null;
  document.getElementById('resize-hint').textContent =
    editState.resize ? `→ ${editState.resize.w} × ${editState.resize.h} px` : '';
});

resizeH.addEventListener('input', () => {
  const h = parseInt(resizeH.value);
  if (resizeLock.checked && h) {
    resizeW.value = Math.round(h * getNaturalAspect());
  }
  editState.resize = h && parseInt(resizeW.value)
    ? { w: parseInt(resizeW.value), h } : null;
  document.getElementById('resize-hint').textContent =
    editState.resize ? `→ ${editState.resize.w} × ${editState.resize.h} px` : '';
});

// ── Save all edits ────────────────────────────────────────────────────────────

document.getElementById('lb-save').addEventListener('click', async () => {
  if (!lightboxId) return;
  const payload = {
    new_name:          document.getElementById('lb-rename').value.trim(),
    caption:           document.getElementById('lb-caption').value,
    ...editState,
  };
  const res  = await fetch(`${API}/api/photos/${lightboxId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  const idx  = photos.findIndex(p => p.id === lightboxId);
  if (idx >= 0) photos[idx] = data;
  updateCard(lightboxId);
  closeLightbox();
  toast('Saved', 'success');
});

document.getElementById('lb-delete').addEventListener('click', () => {
  if (lightboxId) deletePhoto(lightboxId);
});

// ── Layout switcher (stubs for split/focus) ───────────────────────────────────

document.getElementById('layout-gallery').addEventListener('click', () => {
  document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('layout-gallery').classList.add('active');
});
['layout-split', 'layout-focus'].forEach(id =>
  document.getElementById(id).addEventListener('click', () =>
    toast('Split and Focus layouts coming in v1.1')));

// ── Export ────────────────────────────────────────────────────────────────────

document.querySelectorAll('.format-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    exportFormat = btn.dataset.fmt;
    const qSection = document.getElementById('quality-section');
    qSection.style.display = ['jpeg', 'webp'].includes(exportFormat) ? '' : 'none';
  });
});

document.getElementById('export-quality').addEventListener('input', e => {
  exportQuality = parseInt(e.target.value);
  document.getElementById('quality-val').textContent = exportQuality;
});

document.getElementById('btn-export').addEventListener('click', () => {
  if (!photos.length) { toast('No photos to export', 'error'); return; }
  const ids  = [...selected];
  const stat = document.getElementById('export-stat');
  stat.textContent = ids.length
    ? `Export ${ids.length} selected photo${ids.length !== 1 ? 's' : ''}`
    : `Export all ${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  document.getElementById('export-done').style.display     = 'none';
  document.getElementById('export-actions').style.display  = '';
  document.getElementById('export-progress').style.display = 'none';
  document.getElementById('export-modal').style.display    = '';
});

document.getElementById('export-close').addEventListener('click',  () =>
  document.getElementById('export-modal').style.display = 'none');
document.getElementById('export-cancel').addEventListener('click', () =>
  document.getElementById('export-modal').style.display = 'none');

document.getElementById('export-confirm').addEventListener('click', async () => {
  document.getElementById('export-actions').style.display  = 'none';
  document.getElementById('export-progress').style.display = '';
  document.getElementById('export-progress-fill').style.width = '30%';

  const payload = {
    ids:       [...selected],
    format:    exportFormat,
    quality:   exportQuality,
    prefix:    document.getElementById('prefix-input').value.trim(),
    start_num: parseInt(document.getElementById('start-num').value) || 1,
    pad:       parseInt(document.getElementById('pad-select').value),
  };

  document.getElementById('export-progress-fill').style.width = '60%';

  try {
    const res  = await fetch(`${API}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    document.getElementById('export-progress-fill').style.width = '100%';
    setTimeout(() => {
      document.getElementById('export-progress').style.display = 'none';
      document.getElementById('export-done').style.display     = '';
      const link = document.getElementById('export-download-link');
      link.href        = data.download_url;
      link.textContent = `Download ZIP (${data.count} photo${data.count !== 1 ? 's' : ''})`;
    }, 300);
  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
    document.getElementById('export-actions').style.display  = '';
    document.getElementById('export-progress').style.display = 'none';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch(`${API}/api/photos`);
    photos = await res.json();
    renderAll();
  } catch(e) {
    console.error('Could not load photos:', e);
  }
}

init();
