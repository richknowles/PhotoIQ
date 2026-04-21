/* PhotoIQ — frontend app */

const API = '';
let photos = [];
let selected = new Set();
let lightboxId = null;

// ── Utility ───────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmt(bytes) {
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

// ── State sync ────────────────────────────────────────────────────────────
function updateHeader() {
  document.getElementById('stat-count').textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  const sel = selected.size;
  const selPill = document.getElementById('stat-selected');
  const delBtn  = document.getElementById('btn-delete-selected');
  if (sel > 0) {
    selPill.textContent = `${sel} selected`;
    selPill.style.display = '';
    delBtn.style.display  = '';
  } else {
    selPill.style.display = 'none';
    delBtn.style.display  = 'none';
  }
  document.getElementById('toolbar').style.display = photos.length ? '' : 'none';
  document.getElementById('empty-state').style.display = photos.length ? 'none' : '';
}

// ── Render ────────────────────────────────────────────────────────────────
function renderCard(photo) {
  const card = document.createElement('div');
  card.className = `photo-card${selected.has(photo.id) ? ' selected' : ''}`;
  card.dataset.id = photo.id;

  const captionText = photo.caption || '';
  const displayName = photo.new_name || photo.original_name || '';

  card.innerHTML = `
    <div class="card-check">✓</div>
    <img class="card-thumb" src="${photo.thumb_url || photo.url}" alt="${displayName}" loading="lazy" />
    <div class="card-body">
      <div class="card-name">${displayName}</div>
      <div class="card-caption ${captionText ? '' : 'empty'}">${captionText || 'No caption'}</div>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-action="edit">Edit</button>
      <button class="card-btn danger" data-action="delete">Delete</button>
    </div>
  `;

  // Toggle select on click (but not on action buttons)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-btn')) return;
    toggleSelect(photo.id);
  });

  // Double-click = lightbox
  card.addEventListener('dblclick', (e) => {
    if (e.target.closest('.card-btn')) return;
    openLightbox(photo.id);
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openLightbox(photo.id);
  });

  card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
    e.stopPropagation();
    deletePhoto(photo.id);
  });

  return card;
}

function renderAll() {
  const sheet = document.getElementById('contact-sheet');
  // Keep empty state element, remove cards
  const existing = sheet.querySelectorAll('.photo-card');
  existing.forEach(el => el.remove());

  photos.forEach(p => sheet.appendChild(renderCard(p)));
  updateHeader();
}

function updateCard(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  const old = document.querySelector(`[data-id="${id}"]`);
  if (old) old.replaceWith(renderCard(photo));
}

// ── Selection ─────────────────────────────────────────────────────────────
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

// ── Upload ────────────────────────────────────────────────────────────────
async function uploadFiles(files) {
  if (!files.length) return;
  const bar  = document.getElementById('upload-bar');
  const fill = document.getElementById('upload-bar-fill');
  const lbl  = document.getElementById('upload-bar-label');
  bar.style.display = '';
  fill.style.width = '0%';

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
      fill.style.width = `${Math.round(done / total * 100)}%`;
      lbl.textContent = `${done} / ${total} uploaded`;
      renderAll();
    } catch(e) {
      toast('Upload error: ' + e.message, 'error');
    }
  }

  setTimeout(() => { bar.style.display = 'none'; }, 800);
  toast(`${total} photo${total !== 1 ? 's' : ''} uploaded`, 'success');
}

// Drag & drop
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});
dz.addEventListener('click', () => document.getElementById('file-input').click());

document.getElementById('file-input').addEventListener('change', e => {
  uploadFiles(e.target.files);
  e.target.value = '';
});

// ── Delete ────────────────────────────────────────────────────────────────
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

// ── Lightbox ──────────────────────────────────────────────────────────────
function openLightbox(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  lightboxId = id;

  document.getElementById('lb-image').src = photo.url;
  document.getElementById('lb-filename').textContent = photo.original_name || photo.filename;
  document.getElementById('lb-rename').value = photo.new_name || '';
  document.getElementById('lb-caption').value = photo.caption || '';
  document.getElementById('lightbox').style.display = '';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  lightboxId = null;
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-backdrop').addEventListener('click', closeLightbox);

document.getElementById('lb-save').addEventListener('click', async () => {
  if (!lightboxId) return;
  const fd = new FormData();
  fd.append('new_name', document.getElementById('lb-rename').value);
  fd.append('caption',  document.getElementById('lb-caption').value);

  const res  = await fetch(`${API}/api/photos/${lightboxId}`, { method: 'PATCH', body: fd });
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

// ── Export ────────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const modal = document.getElementById('export-modal');
  const ids   = [...selected];
  const stat  = document.getElementById('export-stat');
  stat.textContent = ids.length
    ? `Export ${ids.length} selected photo${ids.length !== 1 ? 's' : ''}`
    : `Export all ${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  document.getElementById('export-done').style.display    = 'none';
  document.getElementById('export-actions').style.display = '';
  document.getElementById('export-progress').style.display = 'none';
  modal.style.display = '';
});

document.getElementById('export-close').addEventListener('click', () => {
  document.getElementById('export-modal').style.display = 'none';
});
document.getElementById('export-cancel').addEventListener('click', () => {
  document.getElementById('export-modal').style.display = 'none';
});

document.getElementById('export-confirm').addEventListener('click', async () => {
  document.getElementById('export-actions').style.display  = 'none';
  document.getElementById('export-progress').style.display = '';
  document.getElementById('export-progress-fill').style.width = '30%';

  const ids     = [...selected];
  const payload = {
    ids:       ids,
    watermark: document.getElementById('wm-toggle').checked,
    opacity:   parseInt(document.getElementById('wm-opacity').value) / 100,
    scale:     parseInt(document.getElementById('wm-scale').value)   / 100,
    angle:     parseInt(document.getElementById('wm-angle').value),
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
      link.href = data.download_url;
      link.textContent = `Download ZIP (${data.count} photos)`;
    }, 300);
  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
    document.getElementById('export-actions').style.display = '';
    document.getElementById('export-progress').style.display = 'none';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────
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
