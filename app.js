/* ==========================================================================
   FotoDown — semua proses lokal di browser. Vanilla JS, tanpa dependency.
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  items: [],
  maxSize: 1920,
  quality: 0.75,
  format: "image/jpeg",
  targetKb: 0,
  uid: 0,
};
window.__fd = state;          // hook debug/verifikasi

const EXT = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

/* ---------------- util ---------------- */
function fmtBytes(b) {
  if (b === null || b === undefined) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canShareFiles() {
  return !!(navigator.canShare && navigator.share);
}

/* Simpan ke galeri HP: share sheet (Android: Files/Photos, iOS: Save Image) */
async function savePhoto(item) {
  const file = new File([item.blob], item.outName, { type: item.blob.type });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: item.outName });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  downloadBlob(item.blob, item.outName);
}

/* ---------------- decode & encode ---------------- */
async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) { /* fallback */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("format tidak didukung browser ini"));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((res) => {
    if (canvas.convertToBlob) {
      canvas.convertToBlob({ type, quality }).then(res).catch(() => res(null));
      return;
    }
    canvas.toBlob((b) => res(b), type, quality);
  });
}

function drawScaled(src, w, h, fillWhite) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: !fillWhite });
  if (fillWhite) {                       // JPEG tidak punya alpha
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

async function compress(file) {
  const src = await decodeImage(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error("gambar tidak terbaca");

  const { maxSize, format, quality, targetKb } = state;
  const fillWhite = format === "image/jpeg";

  let w = sw, h = sh;
  if (maxSize > 0 && Math.max(sw, sh) > maxSize) {
    const k = maxSize / Math.max(sw, sh);
    w = Math.max(1, Math.round(sw * k));
    h = Math.max(1, Math.round(sh * k));
  }

  let blob = null;

  if (targetKb > 0 && format !== "image/png") {
    const target = targetKb * 1024;
    for (let attempt = 0; attempt < 4 && !blob; attempt++) {
      const canvas = drawScaled(src, w, h, fillWhite);
      let lo = 0.25, hi = 0.95, best = null;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await canvasToBlob(canvas, format, q);
        if (!b) break;
        if (b.size <= target) { best = b; lo = q; } else { hi = q; }
      }
      if (best) { blob = best; break; }
      const floor = await canvasToBlob(canvas, format, 0.3);   // masih kelebihan: kecilkan dimensi
      if (floor && floor.size <= target) { blob = floor; break; }
      w = Math.max(160, Math.round(w * 0.8));
      h = Math.max(160, Math.round(h * 0.8));
    }
  }

  if (!blob) {
    const canvas = drawScaled(src, w, h, fillWhite);
    blob = await canvasToBlob(canvas, format, format === "image/png" ? undefined : quality);
  }
  if (!blob) throw new Error("gagal encode");

  if (src.close) { try { src.close(); } catch (_) {} }

  const base = file.name.replace(/\.[^.]+$/, "") || "foto";
  return { blob, outName: `${base}-fotodown.${EXT[format] || "jpg"}`, w, h };
}

/* ---------------- baris hasil ---------------- */
function rowFor(item) {
  const row = $("#rowTpl").content.firstElementChild.cloneNode(true);
  item.el = row;
  row.dataset.id = item.id;
  row.querySelector(".fname").textContent = item.file.name;
  row.querySelector(".fname").title = item.file.name;
  row.querySelector(".orig").textContent = fmtBytes(item.origSize);
  row.querySelector(".thumb").src = item.thumbUrl;
  row.querySelector(".btn-save").hidden = true;
  row.querySelector(".retry").hidden = true;
  row.querySelector(".retry").addEventListener("click", () => run(item));
  return row;
}

function setStatus(item, text, cls) {
  item.el.querySelector(".fstatus").textContent = text;
  item.el.classList.remove("is-done", "is-error");
  if (cls) item.el.classList.add(cls);
}

function paintDone(item) {
  const { el, blob, origSize, outName, outW, outH } = item;
  el.querySelector(".out").textContent = fmtBytes(blob.size);
  el.querySelector(".dims").textContent = `${outW}×${outH}`;
  el.querySelector(".thumb").src = URL.createObjectURL(blob);

  const saved = origSize > 0 ? Math.round((1 - blob.size / origSize) * 100) : 0;
  el.querySelector(".pct").textContent = saved > 0 ? `−${saved}%` : "0%";
  el.querySelector(".meter i").style.transform = `scaleX(${Math.min(1, Math.max(0.02, saved / 100))})`;
  el.querySelector(".fmetric").textContent =
    `${outW}×${outH} · ${fmtBytes(origSize)} → ${fmtBytes(blob.size)}`;
  setStatus(item, "selesai", "is-done");

  const a = el.querySelector(".btn-save");
  a.hidden = false;
  a.textContent = canShareFiles() ? "Simpan" : "Unduh";
  a.title = canShareFiles() ? "Simpan ke galeri" : "Unduh file";
  a.href = URL.createObjectURL(blob);
  a.download = outName;
  a.onclick = (ev) => {
    if (canShareFiles()) { ev.preventDefault(); savePhoto(item); }
  };
}

function paintError(item, err) {
  setStatus(item, "gagal — " + (err.message || "tidak diketahui"), "is-error");
  item.el.querySelector(".out").textContent = "—";
  item.el.querySelector(".pct").textContent = "—";
  item.el.querySelector(".meter i").style.transform = "scaleX(0)";
  item.el.querySelector(".retry").hidden = false;
}

/* ---------------- pipeline (berurutan, hemat memori) ---------------- */
async function run(item) {
  item.el.querySelector(".retry").hidden = true;
  setStatus(item, "memproses…");
  try {
    const { blob, outName, w, h } = await compress(item.file);
    Object.assign(item, { blob, outName, outW: w, outH: h, status: "done" });
    paintDone(item);
  } catch (err) {
    console.warn("gagal:", item.file.name, err);
    item.status = "error";
    paintError(item, err);
  }
  updateTotals();
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;

  const fresh = files.map((file) => ({
    id: ++state.uid,
    file,
    origSize: file.size,
    thumbUrl: URL.createObjectURL(file),
    status: "queued",
    blob: null,
    outName: "",
  }));

  state.items.push(...fresh);
  $("#empty").hidden = true;
  $("#thead").hidden = false;
  fresh.forEach((item) => $("#results").appendChild(rowFor(item)));
  $("#summary").hidden = false;
  updateTotals();

  for (const item of fresh) {
    await run(item);
    await new Promise((r) => setTimeout(r, 12));
  }
}

/* ---------------- total ---------------- */
function updateTotals() {
  const done = state.items.filter((i) => i.status === "done");
  const before = done.reduce((s, i) => s + i.origSize, 0);
  const after = done.reduce((s, i) => s + i.blob.size, 0);
  $("#statBefore").textContent = fmtBytes(before);
  $("#statAfter").textContent = fmtBytes(after);
  const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  $("#statSaved").textContent = (saved > 0 ? "−" : "") + saved + "%";
  $("#zipBtn").disabled = done.length === 0;
  $("#summary").hidden = state.items.length === 0;
}

/* ---------------- ZIP writer (store, tanpa library) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

async function buildZip(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, blob } of entries) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    chunks.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
}

/* ---------------- kontrol ---------------- */
function bindDropzone() {
  const dz = $("#dropzone");
  const input = $("#fileInput");
  const pick = () => input.click();

  dz.addEventListener("click", pick);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) addFiles(input.files);
    input.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-drag"); })
  );
  ["dragleave", "dragend", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-drag"); })
  );
  dz.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) return addFiles(dt.files);
    if (dt.items) {
      addFiles([...dt.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean));
    }
  });

  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });
}

let reprocessToken = 0;
async function reprocess() {
  const items = state.items.filter((i) => i.status === "done" || i.status === "error");
  if (!items.length) return;
  const token = ++reprocessToken;
  for (const item of items) {
    if (token !== reprocessToken) return;      // setting berubah lagi, batalkan batch lama
    await run(item);
  }
}
function reprocessSoon() {
  clearTimeout(reprocessSoon._t);
  reprocessSoon._t = setTimeout(reprocess, 160);
}

function setQualityEnabled() {
  const q = $("#quality");
  const lossy = state.format !== "image/png" && state.targetKb === 0;
  q.disabled = !lossy;
  q.title = lossy ? "" : (state.format === "image/png"
    ? "PNG lossless — kualitas tidak berlaku"
    : "Target ukuran aktif — kualitas dicari otomatis");
}

function bindControls() {
  $$("#sizeSeg .opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("#sizeSeg .opt").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      state.maxSize = Number(btn.dataset.size) || 0;
      reprocessSoon();
    });
  });

  const q = $("#quality");
  q.addEventListener("input", () => {
    state.quality = Number(q.value) / 100;
    $("#qualityVal").textContent = q.value;
  });
  q.addEventListener("change", () => reprocessSoon());

  $$("#formatSeg .opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("#formatSeg .opt").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      state.format = btn.dataset.format;
      setQualityEnabled();
      reprocessSoon();
    });
  });

  const tk = $("#targetKb");
  tk.addEventListener("input", () => {
    state.targetKb = Math.max(0, Number(tk.value) || 0);
    setQualityEnabled();
  });
  tk.addEventListener("change", () => reprocessSoon());

  $("#zipBtn").addEventListener("click", async () => {
    const done = state.items.filter((i) => i.status === "done");
    if (!done.length) return;
    const btn = $("#zipBtn");
    btn.disabled = true;
    btn.textContent = "menyiapkan…";
    try {
      const used = new Set();
      const entries = done.map((i) => {
        let name = i.outName;
        let n = 2;
        while (used.has(name)) name = i.outName.replace(/(\.[^.]+)$/, ` (${n++})$1`);
        used.add(name);
        return { name, blob: i.blob };
      });
      downloadBlob(await buildZip(entries), `FotoDown-${done.length}-foto.zip`);
    } catch (err) {
      alert("Gagal membuat ZIP: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Unduh semua (.zip)";
    }
  });

  $("#clearBtn").addEventListener("click", () => {
    state.items.forEach((i) => URL.revokeObjectURL(i.thumbUrl));
    state.items = [];
    $("#results").innerHTML = "";
    $("#thead").hidden = true;
    $("#empty").hidden = false;
    $("#summary").hidden = true;
  });
}

/* ---------------- PWA ---------------- */
let deferredPrompt = null;
function bindPWA() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("#installBtn").hidden = false;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#installBtn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").then(() => {
      const el = $("#swState");
      el.textContent = "service worker: siap offline";
      el.classList.add("is-on");
    }).catch(() => {});
  }
}

/* ---------------- init ---------------- */
bindDropzone();
bindControls();
bindPWA();
setQualityEnabled();
