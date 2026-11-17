/* ===== FotoDown — kompres foto sepenuhnya di browser ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  items: [],
  maxSize: 1920,       // 0 = ukuran asli
  quality: 0.75,
  format: "image/jpeg",
  targetKb: 0,
  uid: 0,
};

const EXT = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

/* ---------- util ---------- */
function fmtBytes(b) {
  if (!b && b !== 0) return "-";
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

async function saveToGallery(item) {
  const file = new File([item.blob], item.outName, { type: item.blob.type });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: item.outName });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;   // user batal, jangan fallback
    }
  }
  downloadBlob(item.blob, item.outName);
}

/* ---------- decode & encode ---------- */
async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) { /* fallback di bawah */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("Format tidak didukung browser"));
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

function drawScaled(src, targetW, targetH, fillWhite) {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { alpha: !fillWhite });
  if (fillWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, targetW, targetH);
  return canvas;
}

async function compress(file) {
  const src = await decodeImage(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error("Gambar tidak terbaca");

  let { maxSize, format, quality, targetKb } = state;
  const fillWhite = format === "image/jpeg";

  let scale = 1;
  if (maxSize > 0 && Math.max(sw, sh) > maxSize) scale = maxSize / Math.max(sw, sh);
  let w = Math.max(1, Math.round(sw * scale));
  let h = Math.max(1, Math.round(sh * scale));

  let blob = null;

  if (targetKb > 0 && format !== "image/png") {
    // cari kualitas tertinggi yang masih <= target, kalau perlu perkecil dimensi
    const target = targetKb * 1024;
    for (let attempt = 0; attempt < 4; attempt++) {
      let lo = 0.25, hi = 0.95, best = null;
      const canvas = drawScaled(src, w, h, fillWhite);
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await canvasToBlob(canvas, format, q);
        if (!b) break;
        if (b.size <= target) { best = b; lo = q; } else { hi = q; }
      }
      if (best) { blob = best; break; }
      // masih kelebihan di kualitas minimum -> kecilkan dimensi 20%
      blob = await canvasToBlob(canvas, format, 0.3);
      if (blob && blob.size <= target) break;
      w = Math.max(160, Math.round(w * 0.8));
      h = Math.max(160, Math.round(h * 0.8));
    }
  }

  if (!blob) {
    const canvas = drawScaled(src, w, h, fillWhite);
    blob = await canvasToBlob(canvas, format, format === "image/png" ? undefined : quality);
  }
  if (!blob) throw new Error("Gagal encode gambar");

  if (src.close) try { src.close(); } catch (_) {}

  const base = file.name.replace(/\.[^.]+$/, "") || "foto";
  const outName = `${base}-fotodown.${EXT[format] || "jpg"}`;
  return { blob, outName, w, h };
}

/* ---------- kartu hasil ---------- */
function cardFor(item) {
  const node = $("#cardTpl").content.firstElementChild.cloneNode(true);
  item.el = node;
  node.querySelector(".name").textContent = item.file.name;
  node.querySelector(".before").textContent = fmtBytes(item.origSize);
  node.querySelector(".after").textContent = "…";
  node.querySelector(".thumb").src = item.thumbUrl;
  node.querySelector(".badge").textContent = "…";
  node.querySelector(".badge").classList.remove("warn");
  item.el.querySelector(".bar i").style.transform = "scaleX(.05)";
  const dl = node.querySelector(".dl");
  dl.hidden = true;
  const retry = node.querySelector(".retry");
  retry.hidden = true;
  retry.addEventListener("click", () => run(item));
  return node;
}

function paintDone(item) {
  const { el, blob, origSize, outName } = item;
  el.classList.add("done");
  el.querySelector(".after").textContent = fmtBytes(blob.size);
  el.querySelector(".thumb").src = URL.createObjectURL(blob);
  const saved = origSize > 0 ? Math.round((1 - blob.size / origSize) * 100) : 0;
  const badge = el.querySelector(".badge");
  badge.textContent = saved > 0 ? `−${saved}%` : "sudah kecil";
  badge.classList.toggle("warn", saved <= 0);
  el.querySelector(".bar i").style.transform = `scaleX(${Math.min(1, Math.max(0.05, saved / 100))})`;

  const dl = el.querySelector(".dl");
  dl.hidden = false;
  dl.textContent = canShareFiles() ? "Simpan foto" : "Unduh foto";
  dl.href = URL.createObjectURL(blob);
  dl.download = outName;
  dl.onclick = (ev) => {
    if (canShareFiles()) {
      ev.preventDefault();
      saveToGallery(item);
    }
  };
}

function paintError(item, err) {
  const { el } = item;
  el.querySelector(".after").textContent = "gagal";
  el.querySelector(".badge").textContent = "!";
  el.querySelector(".badge").classList.add("warn");
  el.querySelector(".thumb").title = err.message || String(err);
  el.querySelector(".retry").hidden = false;
}

/* ---------- pipeline ---------- */
async function run(item) {
  item.status = "working";
  try {
    const { blob, outName } = await compress(item.file);
    item.blob = blob;
    item.outName = outName;
    item.status = "done";
    paintDone(item);
  } catch (err) {
    item.status = "error";
    console.warn("gagal:", item.file.name, err);
    paintError(item, err);
  }
  updateSummary();
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  $("#results").hidden = false;

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
  fresh.forEach((item) => $("#results").appendChild(cardFor(item)));
  $("#summary").hidden = false;
  updateSummary();

  // proses berurutan supaya memori aman di HP
  for (const item of fresh) {
    await run(item);
    await new Promise((r) => setTimeout(r, 12));
  }
}

/* ---------- ringkasan ---------- */
function updateSummary() {
  const done = state.items.filter((i) => i.status === "done");
  const before = done.reduce((s, i) => s + i.origSize, 0);
  const after = done.reduce((s, i) => s + i.blob.size, 0);
  $("#statCount").textContent = done.length;
  $("#statBefore").textContent = fmtBytes(before);
  $("#statAfter").textContent = fmtBytes(after);
  const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  $("#statSaved").textContent = (saved > 0 ? "−" : "") + saved + "%";
  $("#zipBtn").disabled = done.length === 0;
  $("#summary").hidden = state.items.length === 0;
}

/* ---------- ZIP (store, tanpa dependency) ---------- */
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
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  return { time, date };
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
    dv.setUint16(4, 20, true);          // version needed
    dv.setUint16(6, 0x0800, true);      // UTF-8 flag
    dv.setUint16(8, 0, true);           // store
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
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
}

/* ---------- wiring UI ---------- */
function bindDropzone() {
  const dz = $("#dropzone");
  const input = $("#fileInput");

  const open = () => input.click();
  dz.addEventListener("click", open);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  input.addEventListener("change", () => {
    if (input.files.length) addFiles(input.files);
    input.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
  );
  ["dragleave", "dragend", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
  );
  dz.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) addFiles(dt.files);
    else if (dt.items) {
      const files = [...dt.items].filter((i) => i.kind === "file").map((i) => i.getAsFile());
      addFiles(files.filter(Boolean));
    }
  });

  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });
}

function bindControls() {
  $$("#sizeSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("#sizeSeg button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.maxSize = Number(btn.dataset.size) || 0;
      reprocessSoon();
    });
  });

  const q = $("#quality");
  q.addEventListener("input", () => {
    state.quality = Number(q.value) / 100;
    $("#qualityVal").textContent = q.value + "%";
  });
  q.addEventListener("change", () => reprocessSoon());

  $("#format").addEventListener("change", (e) => {
    state.format = e.target.value;
    $("#quality").disabled = state.format === "image/png";
    reprocessSoon();
  });

  const tk = $("#targetKb");
  tk.addEventListener("change", () => {
    state.targetKb = Math.max(0, Number(tk.value) || 0);
    $("#quality").disabled = state.targetKb > 0 || state.format === "image/png";
    reprocessSoon();
  });

  $("#zipBtn").addEventListener("click", async () => {
    const done = state.items.filter((i) => i.status === "done");
    if (!done.length) return;
    const btn = $("#zipBtn");
    btn.disabled = true;
    btn.textContent = "Menyiapkan…";
    try {
      const used = new Set();
      const entries = done.map((i) => {
        let name = i.outName;
        let n = 2;
        while (used.has(name)) name = i.outName.replace(/(\.[^.]+)$/, ` (${n++})$1`);
        used.add(name);
        return { name, blob: i.blob };
      });
      const zip = await buildZip(entries);
      downloadBlob(zip, `FotoDown-${done.length}-foto.zip`);
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
    $("#summary").hidden = true;
  });
}

async function reprocess() {
  const items = state.items.filter((i) => i.status === "done" || i.status === "error");
  if (!items.length) return;
  const token = ++reprocessToken;
  for (const item of items) {
    if (token !== reprocessToken) return;   // ada perubahan setting baru, hentikan batch lama
    item.el.querySelector(".retry").hidden = true;
    await run(item);
  }
}

let reprocessToken = 0;
function reprocessSoon() {
  clearTimeout(reprocessSoon._t);
  reprocessSoon._t = setTimeout(reprocess, 160);
}

/* ---------- PWA ---------- */
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
      $("#swState").classList.add("on");
      $("#swState").title = "Siap offline";
    }).catch(() => {});
  }
}

/* ---------- init ---------- */
bindDropzone();
bindControls();
bindPWA();
$("#quality").disabled = false;
window.__fd = state;   // buat debug/tes
