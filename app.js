/* Libreta de Cooperaciones — PWA local-first.
   Todos los datos viven en IndexedDB dentro del teléfono; no se envía nada a internet. */
(function () {
"use strict";

/* ===================== utilidades ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmt = n => money.format(Number(n) || 0);
const fdate = iso => { try { return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } };
const ftime = iso => { try { return new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);
const firstChar = s => (String(s || "?").trim().charAt(0) || "?").toUpperCase();

/* ===================== base de datos local (IndexedDB) ===================== */
const STORES = ["grupos", "alumnos", "coops", "aports"];
const mem = { grupos: new Map(), alumnos: new Map(), coops: new Map(), aports: new Map() };
let idb = null;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("libreta-cooperaciones", 1);
    r.onupgradeneeded = () => { const d = r.result; STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = idb.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
async function loadAll() {
  for (const s of STORES) {
    const rows = await new Promise((res, rej) => { const r = idb.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    mem[s] = new Map(rows.map(x => [x.id, x]));
  }
}
async function put(store, obj) {
  mem[store].set(obj.id, obj);
  try { await tx([store], "readwrite", t => t.objectStore(store).put(obj)); }
  catch (e) { toast("No se pudo guardar. Revisa el espacio libre del teléfono."); }
}
async function delMany(pairs) { // [[store,id],...] en una sola transacción
  if (!pairs.length) return;
  pairs.forEach(([s, id]) => mem[s].delete(id));
  const stores = [...new Set(pairs.map(p => p[0]))];
  try { await tx(stores, "readwrite", t => pairs.forEach(([s, id]) => t.objectStore(s).delete(id))); }
  catch (e) { toast("No se pudo borrar. Inténtalo otra vez."); }
}
async function replaceAll(data) {
  await tx(STORES, "readwrite", t => STORES.forEach(s => { const os = t.objectStore(s); os.clear(); (data[s] || []).forEach(r => os.put(r)); }));
  await loadAll();
}
const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

/* ===================== consultas ===================== */
const byName = (a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
const grupos = () => [...mem.grupos.values()].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre, "es"));
const alumnosDe = g => [...mem.alumnos.values()].filter(a => a.grupoId === g).sort(byName);
const coopsDe = g => [...mem.coops.values()].filter(c => c.grupoId === g).sort((a, b) => (b.creada || "").localeCompare(a.creada || ""));
const aportsDe = (coopId, alId) => [...mem.aports.values()].filter(a => a.coopId === coopId && (!alId || a.alumnoId === alId)).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
const sum = arr => Math.round(arr.reduce((s, a) => s + (Number(a.monto) || 0), 0) * 100) / 100;
function estado(coop, total) {
  const meta = Number(coop.meta) || 0;
  if (total <= 0) return { cls: "p-none", txt: "Sin aportar", k: "pend" };
  if (meta > 0 && total < meta) return { cls: "p-warn", txt: "Faltan " + fmt(meta - total), k: "pend" };
  return { cls: "p-ok", txt: meta > 0 ? "Completo" : "Aportó", k: "ok" };
}

/* ===================== rutas (el botón Atrás de Android funciona) ===================== */
// #/  ·  #/respaldo  ·  #/g/<grupo>/<coops|alumnos>  ·  #/c/<coop>  ·  #/c/<coop>/a/<alumno>
let route = { v: "grupos" }, depth = 0;
function parse() {
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "respaldo") return { v: "respaldo" };
  if (p[0] === "g" && mem.grupos.has(p[1])) return { v: "grupo", g: p[1], tab: p[2] === "alumnos" ? "alumnos" : "coops" };
  if (p[0] === "c" && mem.coops.has(p[1])) {
    const c = mem.coops.get(p[1]);
    return { v: "coop", c: p[1], g: c.grupoId, sheet: p[2] === "a" && mem.alumnos.has(p[3]) ? p[3] : null };
  }
  return { v: "grupos" };
}
function nav(hash) { depth++; location.hash = hash; }
function navReplace(hash) { history.replaceState(null, "", hash); onRoute(); }
function up(parentHash) { if (depth > 0) { depth--; history.back(); } else navReplace(parentHash); }
function parentOf(r) { return r.v === "coop" ? (r.sheet ? "#/c/" + r.c : "#/g/" + r.g) : "#/"; }
let lastView = "";
function onRoute() {
  route = parse();
  const key = route.v + (route.g || "") + (route.c || "");
  if (key !== lastView) { ui.form = null; ui.armed = null; ui.edit = null; ui.filtro = "todos"; window.scrollTo(0, 0); lastView = key; }
  render();
}
window.addEventListener("hashchange", onRoute);

/* ===================== estado de interfaz ===================== */
const ui = { form: null, filtro: "todos", armed: null, edit: null, pendingImport: null };
let installEvt = null, faltantes = [], swFallo = false;
const instalada = () => window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: minimal-ui)").matches || navigator.standalone === true;
const ARCHIVOS = ["index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png", "favicon-48.png"];
async function revisarArchivos() {
  if (instalada() || !navigator.onLine || location.protocol === "file:") return;
  const r = await Promise.all(ARCHIVOS.map(f => fetch(f + "?revision=" + Date.now(), { cache: "no-store" }).then(x => x.ok ? null : f).catch(() => null)));
  faltantes = r.filter(Boolean);
  if (faltantes.length && route.v === "grupos") render();
}

/* ===================== íconos ===================== */
const I = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>'
};
function header(eyebrow, title, back, extra) {
  $("#hdr").innerHTML = (back ? `<button class="iconbtn" data-a="up" aria-label="Regresar">${I.back}</button>` : "") +
    `<div class="titles"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div>` + (extra || "");
  document.title = title === "Mis grupos" ? "Libreta de Cooperaciones" : title + " · Cooperaciones";
}

/* ===================== vistas ===================== */
function render() {
  const app = $("#app");
  if (route.v === "grupos") app.innerHTML = vGrupos();
  else if (route.v === "grupo") app.innerHTML = vGrupo();
  else if (route.v === "coop") app.innerHTML = vCoop();
  else if (route.v === "respaldo") app.innerHTML = vRespaldo();
  renderSheet();
}

function vGrupos() {
  header("Cooperaciones escolares", "Mis grupos", false, `<button class="iconbtn" data-a="go" data-h="#/respaldo" aria-label="Respaldo de datos" title="Respaldo de datos">${I.save}</button>`);
  const gs = grupos(); let h = "";
  if (faltantes.length) h += `<div class="card install" style="border-color:var(--danger)"><div class="grow"><strong>Faltan archivos en GitHub</strong><br>Por eso Chrome sólo crea un acceso directo en lugar de instalar la app. Sube a tu repositorio: ${faltantes.map(esc).join(", ")}.</div></div>`;
  else if (swFallo) h += `<div class="card install" style="border-color:var(--danger)"><div class="grow"><strong>La app no pudo prepararse para funcionar sin internet</strong><br>Recarga la página con conexión. Si sigue apareciendo, revisa que sw.js esté en tu repositorio.</div></div>`;
  if (installEvt) h += `<div class="card install"><div class="grow"><strong>Instala la app en tu teléfono</strong><br>Se abre desde la pantalla de inicio y funciona sin internet.</div><button class="btn" data-a="install">Instalar</button></div>`;
  if (!gs.length) h += `<div class="card empty"><strong>Aún no hay grupos</strong>Agrega tu primer grupo, por ejemplo “3° A · Gertrudis Bocanegra”.</div>`;
  else h += `<div class="card list grid2">` + gs.map(g => {
    const al = alumnosDe(g.id).length, cs = coopsDe(g.id), ids = new Set(cs.map(c => c.id));
    const tot = sum([...mem.aports.values()].filter(a => ids.has(a.coopId)));
    return `<button class="row" data-a="go" data-h="#/g/${g.id}/coops"><div class="initial">${esc(firstChar(g.nombre))}</div><div class="grow"><div class="name">${esc(g.nombre)}</div><div class="sub">${esc(g.escuela || "")}${g.escuela ? " · " : ""}${al} alumno${al === 1 ? "" : "s"} · ${cs.length} cooperaci${cs.length === 1 ? "ón" : "ones"}</div></div><div class="money">${fmt(tot)}</div>${I.chev}</button>`;
  }).join("") + `</div>`;
  if (ui.form === "grupo") {
    h += `<form class="card form narrow" data-f="grupo"><h2>Nuevo grupo</h2>
    <div class="field"><label for="g-nombre">Grupo</label><input id="g-nombre" type="text" required placeholder="Ej. 6° A" autocomplete="off"></div>
    <div class="field"><label for="g-escuela">Escuela</label><input id="g-escuela" type="text" placeholder="Ej. Ignacio Manuel Altamirano" autocomplete="off"></div>
    <div class="actions"><button type="button" class="btn line" data-a="cancel">Cancelar</button><button class="btn">Guardar grupo</button></div></form>`;
  } else h += `<button class="btn ghost block narrow" data-a="form" data-f="grupo">+ Agregar grupo</button>`;
  const lb = LS.get("ultimoRespaldo");
  h += `<p class="note">Tus datos se guardan en este dispositivo y funcionan sin internet. ${lb ? "Último respaldo: " + fdate(lb) + "." : "Haz un respaldo de vez en cuando con el botón de arriba."}</p>`;
  return h;
}

function vGrupo() {
  const g = mem.grupos.get(route.g); header(g.escuela || "Grupo", g.nombre, true);
  const tab = route.tab, nA = alumnosDe(g.id).length;
  let h = `<div class="tabs narrow" role="tablist"><button role="tab" aria-selected="${tab === "coops"}" data-a="tab" data-t="coops">Cooperaciones</button><button role="tab" aria-selected="${tab === "alumnos"}" data-a="tab" data-t="alumnos">Alumnos (${nA})</button></div>`;
  if (tab === "coops") {
    const cs = coopsDe(g.id);
    if (ui.form === "coop") h += coopForm(null);
    else h += `<button class="btn ghost block narrow" data-a="form" data-f="coop">+ Nueva cooperación</button>`;
    if (!cs.length) h += `<div class="card empty"><strong>Sin cooperaciones</strong>Crea una con su título, por ejemplo “Material de Educación Artística”, y empieza a registrar lo que da cada alumno.</div>`;
    else h += `<div class="card list grid2">` + cs.map(c => {
      const ap = aportsDe(c.id), tot = sum(ap), dieron = new Set(ap.map(a => a.alumnoId)).size;
      return `<button class="row" data-a="go" data-h="#/c/${c.id}"><div class="coinbadge">$</div><div class="grow"><div class="name">${esc(c.titulo)}</div><div class="sub">${dieron} de ${nA} han aportado${Number(c.meta) > 0 ? " · cuota " + fmt(c.meta) : ""}</div></div><div class="money">${fmt(tot)}</div>${I.chev}</button>`;
    }).join("") + `</div>`;
  } else {
    const al = alumnosDe(g.id), cs = new Set(coopsDe(g.id).map(c => c.id));
    if (ui.form === "alumnos") {
      h += `<form class="card form narrow" data-f="alumnos"><h2>Agregar alumnos</h2>
      <div class="field"><label for="a-lista">Nombres, uno por renglón</label><textarea id="a-lista" required placeholder="García López Ana Sofía&#10;Hernández Ruiz Diego&#10;Martínez Pérez Valeria"></textarea><span class="hint">Puedes pegar la lista completa de tu grupo. Los números al inicio de cada renglón se quitan solos.</span></div>
      <div class="actions"><button type="button" class="btn line" data-a="cancel">Cancelar</button><button class="btn">Agregar</button></div></form>`;
    } else h += `<button class="btn ghost block narrow" data-a="form" data-f="alumnos">+ Agregar alumnos</button>`;
    if (!al.length) h += `<div class="card empty"><strong>Sin alumnos</strong>Pega la lista de tu grupo para empezar.</div>`;
    else h += `<div class="card list grid2">` + al.map(a => {
      if (ui.edit === a.id) return `<form class="row" data-f="renombrar" data-id="${a.id}" style="cursor:default"><input id="r-nombre" type="text" value="${esc(a.nombre)}" required autocomplete="off"><button class="btn" style="flex:none">Guardar</button></form>`;
      const tot = sum([...mem.aports.values()].filter(x => x.alumnoId === a.id && cs.has(x.coopId)));
      const armed = ui.armed === "al:" + a.id;
      return `<div class="row" style="cursor:default"><div class="initial">${esc(firstChar(a.nombre))}</div><div class="grow"><div class="name">${esc(a.nombre)}</div><div class="sub">Total aportado: <span class="money">${fmt(tot)}</span></div></div><button class="xbtn" data-a="edit-al" data-id="${a.id}">Editar</button><button class="xbtn ${armed ? "armed" : ""}" data-a="del-al" data-id="${a.id}">${armed ? "¿Quitar?" : "Quitar"}</button></div>`;
    }).join("") + `</div>`;
  }
  const armedG = ui.armed === "grupo";
  h += `<div class="card danger-zone narrow"><span class="hint">Borrar el grupo elimina también sus alumnos, cooperaciones y aportaciones.</span><button class="btn danger" data-a="del-grupo">${armedG ? "Toca otra vez para borrar el grupo" : "Borrar grupo"}</button></div>`;
  return h;
}

function coopForm(c) {
  return `<form class="card form narrow" data-f="${c ? "editcoop" : "coop"}"><h2>${c ? "Editar cooperación" : "Nueva cooperación"}</h2>
  <div class="field"><label for="c-titulo">Título</label><input id="c-titulo" type="text" required placeholder="Ej. Convivio de Día de Muertos" autocomplete="off" value="${c ? esc(c.titulo) : ""}"></div>
  <div class="field"><label for="c-meta">Cuota por alumno (opcional)</label><input id="c-meta" type="number" inputmode="decimal" min="0" step="0.5" placeholder="Ej. 50" value="${c && Number(c.meta) > 0 ? c.meta : ""}"><span class="hint">Con cuota verás quién la completó y cuánto le falta a cada quien.</span></div>
  <div class="actions"><button type="button" class="btn line" data-a="cancel">Cancelar</button><button class="btn">${c ? "Guardar cambios" : "Crear"}</button></div></form>`;
}

function vCoop() {
  const c = mem.coops.get(route.c), g = mem.grupos.get(c.grupoId);
  header(g ? g.nombre + (g.escuela ? " · " + g.escuela : "") : "", c.titulo, true);
  const al = alumnosDe(c.grupoId), ap = aportsDe(c.id), tot = sum(ap), meta = Number(c.meta) || 0;
  const filas = al.map(a => { const t = sum(ap.filter(x => x.alumnoId === a.id)); return { a, t, e: estado(c, t) }; });
  const okN = filas.filter(f => f.e.k === "ok").length, esperado = meta * al.length;
  const pct = esperado ? Math.min(100, tot / esperado * 100) : 0;
  let side = `<div class="card summary"><div class="big"><div class="label">Recaudado</div><div class="amount">${fmt(tot)}</div></div>
  <div><div class="label">${meta ? "Completaron" : "Aportaron"}</div><div class="stat">${okN} / ${al.length}</div></div>
  <div><div class="label">${meta ? "Meta del grupo" : "Aportaciones"}</div><div class="stat">${meta ? fmt(esperado) : ap.length}</div></div>
  ${meta && esperado ? `<div class="bar" role="img" aria-label="Avance ${Math.round(pct)} por ciento"><span style="width:${pct}%"></span></div>` : ""}
  ${meta ? `<div class="hint" style="grid-column:1/-1">Cuota por alumno: ${fmt(meta)}</div>` : ""}</div>`;
  let tools = `<div class="actions"><button class="btn line" data-a="copiar">Copiar lista</button><button class="btn line" data-a="csv">Descargar Excel (CSV)</button></div>`;
  if (ui.form === "editcoop") tools += coopForm(c);
  else tools += `<button class="btn line" data-a="form" data-f="editcoop">Editar título o cuota</button>`;
  tools += `<div class="card danger-zone"><button class="btn danger" data-a="del-coop">${ui.armed === "coop" ? "Toca otra vez para borrar la cooperación" : "Borrar cooperación"}</button></div>`;

  let main = `<div class="seg" role="group" aria-label="Filtrar alumnos">${[["todos", "Todos"], ["pend", "Pendientes"], ["ok", meta ? "Completos" : "Ya aportaron"]].map(([k, t]) => `<button aria-pressed="${ui.filtro === k}" data-a="filtro" data-k="${k}">${t}</button>`).join("")}</div>`;
  const vis = filas.filter(f => ui.filtro === "todos" || f.e.k === ui.filtro);
  if (!al.length) main += `<div class="card empty"><strong>Este grupo no tiene alumnos</strong>Regresa al grupo y agrega la lista en la pestaña Alumnos.</div>`;
  else if (!vis.length) main += `<div class="card empty"><strong>Nadie en esta lista</strong>${ui.filtro === "pend" ? "Todos están al corriente." : "Todavía nadie ha aportado."}</div>`;
  else main += `<div class="card list">` + vis.map(f => `<button class="row" data-a="go" data-h="#/c/${c.id}/a/${f.a.id}"><div class="initial">${esc(firstChar(f.a.nombre))}</div><div class="grow"><div class="name">${esc(f.a.nombre)}</div><div class="sub"><span class="pill ${f.e.cls}">${esc(f.e.txt)}</span></div></div><span class="money">${fmt(f.t)}</span>${I.chev}</button>`).join("") + `</div>`;
  main += `<p class="note">Toca un alumno para registrar lo que entregó. Cada aportación se suma a lo que ya había dado.</p>`;
  return `<div class="split"><div class="side"><div class="o1">${side}</div><div class="o3 tools">${tools}</div></div><div class="mainc o2">${main}</div></div>`;
}

function vRespaldo() {
  header("Tus datos", "Respaldo", true);
  const n = s => mem[s].size, lb = LS.get("ultimoRespaldo");
  let h = `<div class="card form narrow"><h2>Guardar un respaldo</h2>
  <p class="hint" style="margin:0">La app guarda todo en este teléfono. Si borras los datos del navegador, cambias de teléfono o desinstalas la app, se pierde. Descarga un respaldo cada semana y guárdalo en Google Drive o mándalo a tu correo.</p>
  <p style="margin:0">${n("grupos")} grupos · ${n("alumnos")} alumnos · ${n("coops")} cooperaciones · ${n("aports")} aportaciones</p>
  ${lb ? `<p class="hint" style="margin:0">Último respaldo: ${fdate(lb)}</p>` : ""}
  <button class="btn" data-a="export">Descargar respaldo</button></div>
  <div class="card form narrow"><h2>Restaurar un respaldo</h2>
  <p class="hint" style="margin:0">Elige un archivo de respaldo (.json) descargado antes desde esta app. Reemplaza todos los datos actuales de este dispositivo.</p>`;
  if (ui.pendingImport) {
    const p = ui.pendingImport;
    h += `<p style="margin:0">El archivo contiene ${p.grupos.length} grupos, ${p.alumnos.length} alumnos, ${p.coops.length} cooperaciones y ${p.aports.length} aportaciones${p.fecha ? ", respaldado el " + fdate(p.fecha) : ""}.</p>
    <div class="actions"><button class="btn line" data-a="cancel-import">Cancelar</button><button class="btn danger" data-a="do-import">Reemplazar mis datos</button></div>`;
  } else h += `<button class="btn line" data-a="pick-import">Elegir archivo de respaldo</button>`;
  h += `</div>`;
  return h;
}

function renderSheet() {
  const L = $("#layer");
  if (route.v !== "coop" || !route.sheet) { if (L.innerHTML) L.innerHTML = ""; document.body.style.overflow = ""; return; }
  const c = mem.coops.get(route.c), a = mem.alumnos.get(route.sheet);
  const ap = aportsDe(c.id, a.id), t = sum(ap), meta = Number(c.meta) || 0, falta = meta > 0 ? Math.max(0, meta - t) : 0;
  const keep = document.getElementById("s-monto"), prev = keep ? keep.value : "";
  const chips = [...new Set([falta || null, 10, 20, 50, 100].filter(Boolean))];
  document.body.style.overflow = "hidden";
  L.innerHTML = `<div class="sheet-bg" data-a="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="s-t"><div class="inner">
  <div class="grab"></div>
  <div class="toolbar"><div style="min-width:0"><div class="eyebrow">${esc(c.titulo)}</div><h2 id="s-t" style="overflow-wrap:anywhere">${esc(a.nombre)}</h2></div><button class="linkbtn" data-a="close">Cerrar</button></div>
  <div class="card summary" style="background:var(--bg)"><div><div class="label">Ha dado</div><div class="stat">${fmt(t)}</div></div><div><div class="label">${meta ? "Le falta" : "Aportaciones"}</div><div class="stat">${meta ? fmt(falta) : ap.length}</div></div></div>
  <form data-f="aport" class="form" style="padding:0">
    <div class="field"><label for="s-monto">Cantidad que entrega hoy</label><input id="s-monto" class="amountin" type="number" inputmode="decimal" min="0.5" step="0.5" required placeholder="$0" value="${esc(prev)}"></div>
    <div class="chips">${chips.map(v => `<button type="button" data-a="chip" data-v="${v}">${v === falta && meta ? "Lo que falta · " : ""}${fmt(v)}</button>`).join("")}</div>
    <button class="btn block">Registrar aportación</button>
  </form>
  ${ap.length ? `<div><div class="label" style="margin-bottom:6px">Historial</div><div class="hist">${ap.map(x => { const arm = ui.armed === "ap:" + x.id; return `<div class="h"><span class="money">${fmt(x.monto)}</span><span class="grow">${fdate(x.fecha)} · ${ftime(x.fecha)}</span><button class="xbtn ${arm ? "armed" : ""}" data-a="del-ap" data-id="${x.id}">${arm ? "¿Borrar?" : "Borrar"}</button></div>`; }).join("")}</div></div>` : `<p class="note">Aún no registra aportaciones en esta cooperación.</p>`}
  </div></div>`;
}

/* ===================== avisos ===================== */
let tt;
function toast(msg, action) {
  clearTimeout(tt);
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button data-a="toast-action">${esc(action.label)}</button>` : "");
  el._action = action ? action.fn : null; el.hidden = false;
  if (!action) tt = setTimeout(() => { el.hidden = true; }, 2800);
}

/* ===================== descargas ===================== */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportar() {
  const data = { app: "libreta-cooperaciones", version: 1, fecha: new Date().toISOString() };
  STORES.forEach(s => data[s] = [...mem[s].values()]);
  download(`cooperaciones-respaldo-${today()}.json`, JSON.stringify(data, null, 1), "application/json");
  LS.set("ultimoRespaldo", data.fecha); render(); toast("Respaldo descargado");
}
function csvCell(v) { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV() {
  const c = mem.coops.get(route.c), g = mem.grupos.get(c.grupoId), ap = aportsDe(c.id), meta = Number(c.meta) || 0;
  const rows = [["No.", "Alumno", "Total aportado", meta ? "Cuota" : null, meta ? "Falta" : null, "Estado", "Número de aportaciones", "Última aportación"].filter(x => x !== null)];
  alumnosDe(c.grupoId).forEach((a, i) => {
    const mine = ap.filter(x => x.alumnoId === a.id), t = sum(mine), e = estado(c, t);
    const r = [i + 1, a.nombre, t.toFixed(2)]; if (meta) r.push(meta.toFixed(2), Math.max(0, meta - t).toFixed(2));
    r.push(e.k === "ok" ? (meta ? "Completo" : "Aportó") : (t > 0 ? "Incompleto" : "Sin aportar"), mine.length, mine[0] ? fdate(mine[0].fecha) : "");
    rows.push(r);
  });
  rows.push([]); rows.push(["", "TOTAL", sum(ap).toFixed(2)]);
  const head = `${c.titulo} - ${g ? g.nombre : ""}${g && g.escuela ? " - " + g.escuela : ""}`;
  const text = "﻿" + csvCell(head) + "\n" + rows.map(r => r.map(csvCell).join(",")).join("\n");
  const slug = c.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "cooperacion";
  download(`${slug}-${today()}.csv`, text, "text/csv;charset=utf-8");
  toast("Archivo descargado");
}
function copiar() {
  const c = mem.coops.get(route.c), g = mem.grupos.get(c.grupoId), ap = aportsDe(c.id), meta = Number(c.meta) || 0;
  const lines = alumnosDe(c.grupoId).map((a, i) => { const t = sum(ap.filter(x => x.alumnoId === a.id)); const e = estado(c, t); return `${i + 1}. ${a.nombre} — ${fmt(t)}${e.k === "ok" ? " ✓" : (meta ? " (faltan " + fmt(Math.max(0, meta - t)) + ")" : "")}`; });
  const txt = `*${c.titulo}*\n${g ? g.nombre : ""}${g && g.escuela ? " · " + g.escuela : ""}\nTotal recaudado: ${fmt(sum(ap))}\n\n` + lines.join("\n");
  const fallback = () => { const ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); toast(ok ? "Lista copiada" : "No se pudo copiar"); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast("Lista copiada para pegar en WhatsApp"), fallback); else fallback();
}

/* ===================== clics ===================== */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (!a.startsWith("del-")) ui.armed = null;
  switch (a) {
    case "go": nav(b.dataset.h); break;
    case "up": up(parentOf(route)); break;
    case "close": up("#/c/" + route.c); break;
    case "tab": navReplace(`#/g/${route.g}/${b.dataset.t}`); ui.form = null; render(); break;
    case "form": ui.form = b.dataset.f; render(); setTimeout(() => { const i = document.querySelector("form[data-f] input, form[data-f] textarea"); i && i.focus(); }, 40); break;
    case "cancel": ui.form = null; render(); break;
    case "filtro": ui.filtro = b.dataset.k; render(); break;
    case "chip": { const i = $("#s-monto"); i.value = b.dataset.v; i.focus(); break; }
    case "edit-al": ui.edit = id; render(); setTimeout(() => { const i = $("#r-nombre"); i && (i.focus(), i.select()); }, 40); break;
    case "del-al":
      if (ui.armed === "al:" + id) { ui.armed = null; await delMany([...[...mem.aports.values()].filter(x => x.alumnoId === id).map(x => ["aports", x.id]), ["alumnos", id]]); render(); toast("Alumno quitado"); }
      else { ui.armed = "al:" + id; render(); } break;
    case "del-ap":
      if (ui.armed === "ap:" + id) { ui.armed = null; await delMany([["aports", id]]); render(); toast("Aportación borrada"); }
      else { ui.armed = "ap:" + id; renderSheet(); } break;
    case "del-coop":
      if (ui.armed === "coop") { ui.armed = null; const cid = route.c, gid = route.g; await delMany([...aportsDe(cid).map(x => ["aports", x.id]), ["coops", cid]]); depth = 0; navReplace(`#/g/${gid}/coops`); toast("Cooperación borrada"); }
      else { ui.armed = "coop"; render(); } break;
    case "del-grupo":
      if (ui.armed === "grupo") {
        ui.armed = null; const gid = route.g, cs = coopsDe(gid).map(c => c.id), cset = new Set(cs);
        await delMany([...[...mem.aports.values()].filter(x => cset.has(x.coopId)).map(x => ["aports", x.id]), ...cs.map(c => ["coops", c]), ...alumnosDe(gid).map(x => ["alumnos", x.id]), ["grupos", gid]]);
        depth = 0; navReplace("#/"); toast("Grupo borrado");
      } else { ui.armed = "grupo"; render(); } break;
    case "copiar": copiar(); break;
    case "csv": exportCSV(); break;
    case "export": exportar(); break;
    case "pick-import": $("#importFile").value = ""; $("#importFile").click(); break;
    case "cancel-import": ui.pendingImport = null; render(); break;
    case "do-import": { const p = ui.pendingImport; ui.pendingImport = null; await replaceAll(p); depth = 0; navReplace("#/"); toast("Respaldo restaurado"); break; }
    case "install": if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; render(); if (r && r.outcome === "accepted") toast("App instalada"); } break;
    case "toast-action": { const el = $("#toast"); el.hidden = true; el._action && el._action(); break; }
  }
});

$("#importFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "libreta-cooperaciones" || !STORES.every(s => Array.isArray(d[s]))) throw new Error("formato");
    const okRow = r => r && typeof r === "object" && typeof r.id === "string" && r.id;
    if (!STORES.every(s => d[s].every(okRow))) throw new Error("formato");
    ui.pendingImport = d; render();
  } catch (err) { toast("Ese archivo no es un respaldo de esta app"); }
});

/* ===================== formularios ===================== */
document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target.dataset.f;
  if (f === "grupo") {
    const n = $("#g-nombre").value.trim(); if (!n) return;
    await put("grupos", { id: newId(), nombre: n, escuela: $("#g-escuela").value.trim(), orden: grupos().length, creado: new Date().toISOString() });
    ui.form = null; render(); toast("Grupo creado");
  }
  if (f === "coop" || f === "editcoop") {
    const t = $("#c-titulo").value.trim(); if (!t) return; const m = parseFloat($("#c-meta").value); const meta = isFinite(m) && m > 0 ? m : 0;
    if (f === "coop") await put("coops", { id: newId(), grupoId: route.g, titulo: t, meta, creada: new Date().toISOString() });
    else await put("coops", { ...mem.coops.get(route.c), titulo: t, meta });
    ui.form = null; render(); toast(f === "coop" ? "Cooperación creada" : "Cambios guardados");
  }
  if (f === "alumnos") {
    const ns = $("#a-lista").value.split(/\r?\n/).map(s => s.replace(/^\s*\d+\s*[.)\-–]?\s*/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!ns.length) return;
    const ya = new Set(alumnosDe(route.g).map(a => a.nombre.toLowerCase())); const nuevos = [];
    ns.forEach(nm => { if (!ya.has(nm.toLowerCase())) { ya.add(nm.toLowerCase()); nuevos.push({ id: newId() + nuevos.length, grupoId: route.g, nombre: nm }); } });
    nuevos.forEach(x => mem.alumnos.set(x.id, x));
    try { await tx(["alumnos"], "readwrite", t => nuevos.forEach(x => t.objectStore("alumnos").put(x))); } catch (err) { toast("No se pudo guardar la lista."); }
    ui.form = null; render(); toast(nuevos.length ? `${nuevos.length} alumno${nuevos.length === 1 ? "" : "s"} agregado${nuevos.length === 1 ? "" : "s"}` : "Esos alumnos ya estaban en la lista");
  }
  if (f === "renombrar") {
    const n = $("#r-nombre").value.replace(/\s+/g, " ").trim(); const id = e.target.dataset.id; if (!n) return;
    await put("alumnos", { ...mem.alumnos.get(id), nombre: n }); ui.edit = null; render();
  }
  if (f === "aport") {
    const m = parseFloat($("#s-monto").value);
    if (!(m > 0)) { toast("Escribe una cantidad mayor a cero"); return; }
    const al = mem.alumnos.get(route.sheet);
    $("#s-monto").value = "";
    await put("aports", { id: newId(), coopId: route.c, alumnoId: route.sheet, monto: Math.round(m * 100) / 100, fecha: new Date().toISOString() });
    render(); toast(`${fmt(m)} registrados a ${al ? al.nombre.split(" ")[0] : "alumno"}`);
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && route.sheet) up("#/c/" + route.c); });

/* ===================== instalación y actualizaciones ===================== */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (route.v === "grupos") render(); });
window.addEventListener("appinstalled", () => { installEvt = null; render(); });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      const offer = w => toast("Hay una versión nueva de la app", { label: "Actualizar", fn: () => w.postMessage("SKIP_WAITING") });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
      });
    }).catch(() => { swFallo = true; if (route.v === "grupos") render(); });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  });
}

/* ===================== arranque ===================== */
async function start() {
  try { idb = await openDB(); await loadAll(); }
  catch (e) { $("#app").innerHTML = `<div class="card empty"><strong>No se pudo abrir la libreta</strong>Este navegador no permite guardar datos. Abre la app en Chrome sin modo incógnito.</div>`; return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (!LS.get("iniciado") && mem.grupos.size === 0) {
    const ahora = new Date().toISOString();
    await put("grupos", { id: "gb-3a", nombre: "3° A", escuela: "Gertrudis Bocanegra", orden: 0, creado: ahora });
    await put("grupos", { id: "ima-6a", nombre: "6° A", escuela: "Ignacio Manuel Altamirano", orden: 1, creado: ahora });
  }
  LS.set("iniciado", "1");
  if (location.hash && parse().v !== "grupos") { // si abre en una pantalla interna, deja Inicio detrás para que Atrás funcione
    const target = location.hash; history.replaceState(null, "", "#/"); history.pushState(null, "", target); depth = 1;
  }
  onRoute();
  revisarArchivos();
}
start();
})();
