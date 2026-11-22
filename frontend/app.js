"use strict";
const API = ""; // same origin. For mobile or a separate host later: "https://api.your-domain.in"

/* ---------- tiny helpers ---------- */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const isHttp = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

// <md> safe mini-markdown: escape first, then add a few tags. No raw HTML ever reaches innerHTML.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
const IMG_LINE = /^\s*!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)\s*$/;
function figure(alt, url) {
  const a = esc(alt || "Image"), u = esc(url);
  // hidden until the image has really loaded (see wireImages); no loading="lazy" because hidden images would never load
  return `<figure class="mdimg" hidden><a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="${a}" decoding="async" referrerpolicy="no-referrer"></a><figcaption aria-hidden="true">${a}</figcaption></figure>`;
}
function md(text) {
  const out = [];
  let list = null, figs = [];
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flush = () => { if (figs.length) { out.push('<div class="gallery">' + figs.join("") + "</div>"); figs = []; } };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(IMG_LINE))) { close(); figs.push(figure(m[1], m[2])); continue; }
    if (!line.trim()) { close(); continue; }          // blank lines keep consecutive images in one row
    flush();
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      close();
      out.push(`<p>${inline(line.replace(/^#{1,6}\s+/, ""))}</p>`);
    }
  }
  close(); flush();
  return out.join("");
}
// Show an image only once it has loaded. Broken, blocked, slow or tiny ones (icons, tracking pixels) are removed.
function wireImages(root) {
  root.querySelectorAll("figure.mdimg").forEach((fig) => {
    const img = fig.querySelector("img");
    const drop = () => {
      const g = fig.parentElement;
      fig.remove();
      if (g && g.classList.contains("gallery") && !g.children.length) g.remove();
    };
    const check = () => (img.naturalWidth < 80 || img.naturalHeight < 60 ? drop() : (fig.hidden = false));
    img.addEventListener("error", drop);
    img.addEventListener("load", check);
    if (img.complete) { if (img.naturalWidth) check(); else if (img.getAttribute("src")) drop(); } // cached or already failed
    setTimeout(() => { if (fig.isConnected && fig.hidden) drop(); }, 12000);                   // never leave a hanging image
  });
}
// </md>

/* ---------- state (browser only; the server stores nothing) ---------- */
const K = { chats: "scb.chats", mem: "scb.mem", memOn: "scb.memOn", cur: "scb.cur" };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
let chats = store.get(K.chats, []);
let memory = store.get(K.mem, []);
let memOn = store.get(K.memOn, true);
let curId = store.get(K.cur, null);
let busy = false, ctrl = null, pending = [], lastFiles = [];

const cur = () => chats.find((c) => c.id === curId);
const save = () => {
  chats.sort((a, b) => b.updated - a.updated);
  chats = chats.slice(0, 50);
  store.set(K.chats, chats);
  store.set(K.cur, curId);
};
function ensureChat() {
  if (!cur()) {
    if (chats[0]) curId = chats[0].id;
    else { const c = { id: uid(), title: "New chat", updated: Date.now(), messages: [] }; chats.unshift(c); curId = c.id; }
  }
}

/* ---------- sidebar ---------- */
function renderSide() {
  const list = $("#chatList");
  list.textContent = "";
  chats.forEach((c) => {
    const row = el("div", "chat" + (c.id === curId ? " on" : ""));
    const t = el("button", "t", c.title);
    t.title = c.title;
    t.onclick = () => { curId = c.id; save(); renderAll(); closeSide(); };
    const r = el("button", "x", "✎");
    r.setAttribute("aria-label", "Rename chat");
    r.onclick = () => {
      const n = prompt("Rename chat", c.title);
      if (n && n.trim()) { c.title = n.trim().slice(0, 60); save(); renderSide(); }
    };
    const d = el("button", "x", "✕");
    d.setAttribute("aria-label", "Delete chat");
    d.onclick = () => {
      if (!confirm("Delete this chat?")) return;
      chats = chats.filter((x) => x !== c);
      if (curId === c.id) curId = null;
      ensureChat(); save(); renderAll();
    };
    row.append(t, r, d);
    list.append(row);
  });
}
const closeSide = () => { $("#side").classList.remove("open"); $("#menu").setAttribute("aria-expanded", "false"); };

function newChat() {
  if (cur() && !cur().messages.length) { closeSide(); return $("#input").focus(); }
  const c = { id: uid(), title: "New chat", updated: Date.now(), messages: [] };
  chats.unshift(c); curId = c.id; save(); renderAll(); closeSide(); $("#input").focus();
}

/* ---------- messages ---------- */
function msgEl(m) {
  const wrap = el("div", "msg " + (m.role === "user" ? "user" : "bot") + (m.error ? " err" : ""));
  const b = el("div", "b");
  if (m.role === "user") {
    b.textContent = m.text || "";
    if (m.text) wrap.append(b);
    if (m.files && m.files.length) wrap.append(el("div", "files", "📎 " + m.files.join(", ")));
    return wrap;
  }
  if (m.error) b.textContent = m.text; else { b.innerHTML = md(m.text || ""); wireImages(b); }
  wrap.append(b);
  if (m.searches && m.searches.length) wrap.append(el("div", "meta", "Searched: " + m.searches.join(" · ")));
  if (m.sources && m.sources.length) {
    const s = el("div", "sources");
    m.sources.filter((x) => isHttp(x.url)).forEach((x) => {
      const a = el("a", null, x.title || x.url);
      a.href = x.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = x.url;
      s.append(a);
    });
    wrap.append(s);
  }
  const pics = (m.images || []).filter((i) => (i.url || "").startsWith("https://upload.wikimedia.org/"));
  if (pics.length) {
    const p = el("div", "pics");
    pics.forEach((i) => {
      const f = el("figure");
      const img = document.createElement("img");
      img.src = i.url; img.alt = i.title || "Image from Wikimedia Commons";
      img.loading = "lazy"; img.referrerPolicy = "no-referrer";
      const cap = el("figcaption");
      const a = el("a", null, i.title || "Image");
      if (isHttp(i.page)) { a.href = i.page; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      cap.append(a, document.createTextNode(` · ${i.credit} · ${i.license}`));
      f.append(img, cap); p.append(f);
    });
    wrap.append(p);
  }
  if (m.suggest) { // Google Search suggestions widget: shown as-is, but sandboxed
    const f = el("iframe", "sugg");
    f.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    f.title = "Google Search suggestions"; f.referrerPolicy = "no-referrer"; f.srcdoc = m.suggest;
    wrap.append(f);
  }
  if (m.error) {
    const r = el("button", "ghost retry", "Try again");
    r.onclick = () => { const c = cur(); c.messages.pop(); save(); wrap.remove(); ask(c, lastFiles); };
    wrap.append(r);
  }
  return wrap;
}

const SUGGESTIONS = [
  "Where is the State Central Library?",
  "How can a researcher access old Sikkim records?",
  "What does the Song & Drama Unit do?",
  "Show me Sikkimese folk dances",
  "Which festivals are coming up in Sikkim?",
];
function renderLog() {
  const log = $("#log");
  log.textContent = "";
  const c = cur();
  if (!c.messages.length) {
    const e = el("div", "empty");
    e.append(el("h2", null, "Ask about Sikkim’s culture, libraries, archives and performing arts."),
             el("p", null, "Answers come from live web search. You can also attach a photo or PDF."));
    const chips = el("div", "chips");
    SUGGESTIONS.forEach((q) => { const b = el("button", null, q); b.onclick = () => send(q); chips.append(b); });
    e.append(chips); log.append(e);
  }
  c.messages.forEach((m) => log.append(msgEl(m)));
  if (busy) log.append(statusEl());
  log.scrollTop = log.scrollHeight;
}
const statusEl = () => { const s = el("div", "msg bot"); s.id = "status"; s.append(el("div", "meta", "Searching trusted sources…")); return s; };
function addMsg(m) {
  const log = $("#log");
  const e = log.querySelector(".empty"); if (e) e.remove();
  const st = $("#status"); if (st) st.remove();
  log.append(msgEl(m));
  if (busy) log.append(statusEl());
  log.scrollTop = log.scrollHeight;
}
const renderAll = () => { renderSide(); renderLog(); };

/* ---------- sending ---------- */
function setBusy(b) {
  busy = b;
  $("#busybar").classList.toggle("busy", b);
  $("#send").textContent = b ? "Stop" : "Send";
}
function post(fd, signal) {
  let code = null;
  try { code = sessionStorage.getItem("scb.code"); } catch { /* ignore */ }
  return fetch(API + "/api/chat", { method: "POST", body: fd, signal, headers: code ? { "X-Access-Code": code } : {} });
}
async function send(text) {
  text = (text || "").trim();
  if (busy || (!text && !pending.length)) return;
  const c = cur();
  const files = pending;
  const m = { role: "user", text, files: files.map((f) => f.name) };
  c.messages.push(m);
  if (c.title === "New chat" && text) c.title = text.slice(0, 40);
  c.updated = Date.now();
  pending = []; lastFiles = files; renderPending();
  $("#input").value = ""; autosize();
  $("#memOffer").hidden = true;
  save(); renderSide(); addMsg(m);
  await ask(c, files);
}
async function ask(c, files) {
  setBusy(true);
  if (!$("#status")) { $("#log").append(statusEl()); $("#log").scrollTop = $("#log").scrollHeight; }
  const ok = c.messages.filter((m) => !m.error).slice(-10);
  const msgs = ok.map((m, i) => ({
    role: m.role,
    text: m.text || (i === ok.length - 1 ? "" : `[attached: ${(m.files || []).join(", ")}]`),
  }));
  let reply;
  try {
    const fd = new FormData();
    fd.append("payload", JSON.stringify({ messages: msgs, memory: memOn ? memory : [] }));
    files.forEach((f) => fd.append("files", f));
    ctrl = new AbortController();
    let r = await post(fd, ctrl.signal);
    if (r.status === 401) {
      const code = prompt("Access code");
      if (code) { try { sessionStorage.setItem("scb.code", code); } catch { /* ignore */ } r = await post(fd, ctrl.signal); }
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Something went wrong. Please try again.");
    reply = { role: "assistant", text: d.text, sources: d.sources, images: d.images, searches: d.searches, suggest: d.suggestions_html };
    if (d.memory_suggestion && memOn) offerMemory(d.memory_suggestion);
  } catch (e) {
    if (e.name === "AbortError") reply = null; // user pressed Stop
    else reply = { role: "assistant", error: true, text: e instanceof TypeError ? "Can’t reach the server. Check your connection." : e.message };
  }
  setBusy(false);
  const st = $("#status"); if (st) st.remove();
  if (reply) { c.messages.push(reply); addMsg(reply); }
  c.updated = Date.now(); save(); renderSide();
}

/* ---------- attachments ---------- */
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
function renderPending() {
  const box = $("#pending");
  box.textContent = "";
  pending.forEach((f, i) => {
    const s = el("span", null, f.name);
    const x = el("button", null, "✕"); x.type = "button"; x.setAttribute("aria-label", "Remove " + f.name);
    x.onclick = () => { pending.splice(i, 1); renderPending(); };
    s.append(x); box.append(s);
  });
}
function addFiles(list) {
  for (const f of list) {
    if (pending.length >= 3) { alert("You can attach up to 3 files."); break; }
    if (!OK_TYPES.includes(f.type)) { alert(`${f.name}: only JPG, PNG, WebP or PDF.`); continue; }
    if (f.size > 5 * 1024 * 1024) { alert(`${f.name} is over 5 MB.`); continue; }
    pending.push(f);
  }
  renderPending();
}

/* ---------- memory ---------- */
function saveMem() { store.set(K.mem, memory); store.set(K.memOn, memOn); }
function addMem(t) {
  t = t.trim().slice(0, 150);
  if (!t || memory.includes(t) || memory.length >= 20) return;
  memory.push(t); saveMem(); renderMem();
}
function renderMem() {
  $("#memOn").checked = memOn;
  const ul = $("#memList");
  ul.textContent = "";
  if (!memory.length) ul.append(el("li", "muted", "No notes yet."));
  memory.forEach((t, i) => {
    const li = el("li"); const x = el("button", null, "✕");
    x.setAttribute("aria-label", "Delete note"); x.onclick = () => { memory.splice(i, 1); saveMem(); renderMem(); };
    li.append(el("span", null, t), x); ul.append(li);
  });
}
function offerMemory(t) { // never saved silently: the user must confirm
  const box = $("#memOffer");
  box.textContent = "";
  const y = el("button", "primary", "Save"), n = el("button", "ghost", "No");
  y.type = n.type = "button";
  y.onclick = () => { addMem(t); box.hidden = true; };
  n.onclick = () => { box.hidden = true; };
  box.append(el("span", null, `Remember: “${t}”?`), y, n);
  box.hidden = false;
}

/* ---------- wiring ---------- */
function autosize() {
  const t = $("#input");
  if (!t.value) { t.style.height = ""; return; }   // empty: one row (scrollHeight would count the wrapped placeholder)
  t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 144) + "px";
}
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) { if (ctrl) ctrl.abort(); return; }
  send($("#input").value);
});
$("#input").addEventListener("input", autosize);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
});
$("#newChat").onclick = newChat;
$("#menu").onclick = () => { const o = $("#side").classList.toggle("open"); $("#menu").setAttribute("aria-expanded", String(o)); };
document.addEventListener("click", (e) => {
  if (!e.target.closest("#side") && !e.target.closest("#menu")) closeSide();
});
$("#attach").onclick = () => $("#file").click();
$("#file").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
$("#memBtn").onclick = () => { renderMem(); $("#memDlg").showModal(); closeSide(); };
$("#memClose").onclick = () => $("#memDlg").close();
$("#memOn").onchange = (e) => { memOn = e.target.checked; saveMem(); };
$("#memAdd").onclick = () => { addMem($("#memNew").value); $("#memNew").value = ""; };
$("#memNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#memAdd").click(); } });
$("#memClear").onclick = () => { if (confirm("Delete all memory notes?")) { memory = []; saveMem(); renderMem(); } };

/* ---------- accessibility: text size + high contrast (remembered between visits) ---------- */
const SIZES = [14, 16, 18, 20, 24]; // px; 16 = 100%, 24 = 150%
let fs = Math.min(Math.max(store.get("scb.fs", 1), 0), SIZES.length - 1);
function applyA11y() {
  document.documentElement.style.fontSize = SIZES[fs] + "px";
  const hc = !!store.get("scb.hc", false);
  document.body.classList.toggle("hc", hc);
  $("#hc").setAttribute("aria-pressed", String(hc));
}
const setFs = (n) => { fs = Math.min(Math.max(n, 0), SIZES.length - 1); store.set("scb.fs", fs); applyA11y(); };
$("#fsUp").onclick = () => setFs(fs + 1);
$("#fsDown").onclick = () => setFs(fs - 1);
$("#fsReset").onclick = () => setFs(1);
$("#hc").onclick = () => { store.set("scb.hc", !store.get("scb.hc", false)); applyA11y(); };

applyA11y();
ensureChat(); save(); renderAll();