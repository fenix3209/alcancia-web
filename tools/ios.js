/* Alcancía para iPhone: lo que en Android hace la app nativa.
   - Bloqueo con PIN (en vez de huella)
   - Respaldo para compartir o guardar como archivo
   - Sonido de los cerditos en Safari
   - Funcionar sin internet e instrucciones para instalar
   tools/build-web.py lo inserta dentro del código principal de index.html,
   así puede usar sus funciones ($, S, toast, doImport, backupText, actx). */
(function(){
if (window.AndroidBridge) return; // En el APK no se usa nada de esto.

const PIN_KEY = "alcancia.pin";
const GRACE_MS = 30000;          // igual que en Android: pide el PIN si sales más de 30 s
const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

/* ---------- Estilos ---------- */
const css = document.createElement("style");
css.textContent = `
#pinLock{position:fixed;inset:0;z-index:2147483000;background:var(--bg);display:none;flex-direction:column;align-items:center;justify-content:center;padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));text-align:center;font-family:var(--font-body);color:var(--ink)}
#pinLock.open{display:flex}
#pinLock h1{font-family:var(--font-display);font-size:26px;margin:14px 0 4px}
#pinLock p{color:var(--muted);margin:0 0 18px;min-height:1.3em}
#pinLock p.err{color:var(--bad)}
#pinLock .dots{display:flex;gap:14px;margin:6px 0 26px}
#pinLock .dots i{width:16px;height:16px;border-radius:50%;border:2px solid var(--accent);display:block}
#pinLock .dots i.on{background:var(--accent)}
#pinLock .dots.shake{animation:pinShake .35s}
@keyframes pinShake{20%,60%{transform:translateX(-9px)}40%,80%{transform:translateX(9px)}}
#pinLock .pad{display:grid;grid-template-columns:repeat(3,76px);gap:14px}
#pinLock .pad button{height:76px;border-radius:50%;border:0;background:var(--surface);color:var(--ink);font:600 28px var(--font-body);box-shadow:0 1px 0 var(--line);-webkit-tap-highlight-color:transparent}
#pinLock .pad button:active{background:var(--line)}
#pinLock .pad button.ghost{background:transparent;box-shadow:none;font-size:16px;color:var(--muted)}
#pinLock .pad button:disabled{opacity:.35}
#pinLock .foot{margin-top:22px;display:flex;gap:18px}
#pinLock .foot button{background:none;border:0;color:var(--accent);font:600 15px var(--font-body);padding:8px}
#pinLock .forgot{display:none;max-width:320px;margin-top:16px}
#pinLock .forgot.open{display:block}
#pinLock .forgot .btn{margin-top:8px}
#pinCover{position:fixed;inset:0;z-index:2147482999;background:var(--bg);display:none}
#pinCover.open{display:block}
`;
document.head.appendChild(css);

/* ---------- Pantalla de PIN ---------- */
const lock = document.createElement("div");
lock.id = "pinLock";
lock.setAttribute("role", "dialog");
lock.setAttribute("aria-modal", "true");
lock.setAttribute("aria-labelledby", "pinTitle");
lock.innerHTML = `
  <img src="icons/icon-192.png" alt="" width="72" height="72" style="border-radius:18px">
  <h1 id="pinTitle">Alcancía</h1>
  <p id="pinMsg" aria-live="polite">Escribe tu PIN</p>
  <div class="dots" id="pinDots" aria-hidden="true"></div>
  <div class="pad" id="pinPad">
    ${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join("")}
    <button type="button" class="ghost" data-k="cancel" id="pinCancel">Cancelar</button>
    <button type="button" data-k="0">0</button>
    <button type="button" class="ghost" data-k="del" aria-label="Borrar">⌫</button>
  </div>
  <div class="foot"><button type="button" id="pinForgotBtn">Olvidé mi PIN</button></div>
  <div class="forgot" id="pinForgot">
    <p>El PIN no se puede recuperar. Puedes borrar los datos de este teléfono y empezar de nuevo, o restaurar un respaldo después.</p>
    <button class="btn block" type="button" id="pinWipe" style="background:var(--bad)">Borrar mis datos y quitar el PIN</button>
    <button class="btn ghost block" type="button" id="pinForgotNo">Mejor no</button>
  </div>`;
const cover = document.createElement("div");
cover.id = "pinCover";
document.body.append(lock, cover);

const PIN_LEN_MIN = 4, PIN_LEN_MAX = 6;
let entry = "", mode = null, firstPin = "", onDone = null, fails = 0, waitUntil = 0, waitTimer = null, wipeArmed = false;

function stored(){ try{ const p = JSON.parse(localStorage.getItem(PIN_KEY)); return p && p.hash ? p : null; }catch(e){ return null; } }
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPin(pin, saltB64, iter){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:unb64(saltB64), iterations:iter}, key, 256);
  return b64(bits);
}
async function savePin(pin){
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const iter = 150000;
  localStorage.setItem(PIN_KEY, JSON.stringify({salt, iter, hash: await hashPin(pin, salt, iter)}));
}
async function checkPin(pin){
  const p = stored(); if(!p) return true;
  const h = await hashPin(pin, p.salt, p.iter || 150000);
  let diff = h.length ^ p.hash.length;
  for(let i=0;i<Math.min(h.length,p.hash.length);i++) diff |= h.charCodeAt(i) ^ p.hash.charCodeAt(i);
  return diff === 0;
}

const dots = lock.querySelector("#pinDots"), msg = lock.querySelector("#pinMsg");
function drawDots(){
  const n = mode === "unlock" ? Math.max(PIN_LEN_MIN, (stored()||{}).len || PIN_LEN_MIN) : Math.max(PIN_LEN_MIN, entry.length);
  dots.innerHTML = Array.from({length: Math.min(PIN_LEN_MAX, Math.max(n, entry.length))}, (_, i) => `<i class="${i < entry.length ? "on" : ""}"></i>`).join("");
}
function say(text, err){ msg.textContent = text; msg.classList.toggle("err", !!err); }
function shake(){ dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake"); }

function openLock(m, done){
  mode = m; entry = ""; firstPin = ""; onDone = done || null; wipeArmed = false;
  lock.querySelector("#pinForgot").classList.remove("open");
  lock.querySelector("#pinForgotBtn").style.display = m === "unlock" ? "" : "none";
  lock.querySelector("#pinCancel").style.visibility = m === "unlock" ? "hidden" : "visible";
  say(m === "create" ? `Crea un PIN de ${PIN_LEN_MIN} a ${PIN_LEN_MAX} números` : m === "off" ? "Escribe tu PIN para quitarlo" : "Escribe tu PIN");
  drawDots(); lock.classList.add("open"); cover.classList.remove("open");
  updateWait();
}
function closeLock(){ lock.classList.remove("open"); mode = null; entry = ""; }

function updateWait(){
  const pad = lock.querySelectorAll("#pinPad button[data-k]:not(.ghost)");
  const left = Math.ceil((waitUntil - Date.now()) / 1000);
  if(left > 0){
    pad.forEach(b => b.disabled = true);
    say(`Demasiados intentos. Espera ${left} s`, true);
    clearTimeout(waitTimer); waitTimer = setTimeout(updateWait, 1000);
  }else{
    pad.forEach(b => b.disabled = false);
    if(waitUntil){ waitUntil = 0; say("Escribe tu PIN"); }
  }
}

async function submit(){
  const pin = entry;
  if(mode === "create"){
    if(!firstPin){
      if(pin.length < PIN_LEN_MIN){ say(`Mínimo ${PIN_LEN_MIN} números`, true); shake(); return; }
      firstPin = pin; entry = ""; drawDots(); say("Escríbelo otra vez para confirmar"); return;
    }
    if(pin !== firstPin){ firstPin = ""; entry = ""; drawDots(); shake(); say("No coinciden. Crea el PIN de nuevo", true); return; }
    await savePin(pin);
    const p = stored(); p.len = pin.length; localStorage.setItem(PIN_KEY, JSON.stringify(p));
    const done = onDone; closeLock(); done && done(true); return;
  }
  // unlock / off
  if(await checkPin(pin)){
    fails = 0;
    if(mode === "off") localStorage.removeItem(PIN_KEY);
    const done = onDone; closeLock(); done && done(true);
  }else{
    fails++; entry = ""; drawDots(); shake();
    if(fails >= 5){ waitUntil = Date.now() + Math.min(300, 30 * 2 ** (fails - 5)) * 1000; updateWait(); }
    else say(`PIN incorrecto${fails >= 3 ? ` (${5 - fails} intentos antes de esperar)` : ""}`, true);
  }
}

function press(k){
  if(!mode || Date.now() < waitUntil) return;
  if(k === "del"){ entry = entry.slice(0, -1); drawDots(); return; }
  if(k === "cancel"){ const done = onDone; closeLock(); done && done(false); return; }
  if(entry.length >= PIN_LEN_MAX) return;
  entry += k; drawDots();
  const target = mode === "create" ? null : ((stored()||{}).len || null);
  if(target && entry.length === target) submit();
  else if(mode === "create" && entry.length === PIN_LEN_MAX) submit();
  else if(!target && mode !== "create" && entry.length === PIN_LEN_MAX) submit();
}
lock.querySelector("#pinPad").addEventListener("click", e => { const b = e.target.closest("button[data-k]"); if(b) press(b.dataset.k); });
document.addEventListener("keydown", e => {
  if(!mode) return;
  if(/^[0-9]$/.test(e.key)) press(e.key);
  else if(e.key === "Backspace") press("del");
  else if(e.key === "Enter" && mode === "create" && entry.length >= PIN_LEN_MIN) submit();
});
// Al crear un PIN de 4 o 5 números, se confirma tocando "Listo".
const okBtn = document.createElement("button");
okBtn.type = "button"; okBtn.textContent = "Listo"; okBtn.id = "pinOk";
lock.querySelector(".foot").appendChild(okBtn);
okBtn.addEventListener("click", () => { if(mode === "create" && entry.length >= PIN_LEN_MIN) submit(); });
new MutationObserver(() => { okBtn.style.display = mode === "create" ? "" : "none"; lock.querySelector(".foot").style.display = (mode === "unlock" || mode === "create") ? "" : "none"; })
  .observe(lock, {attributes:true, attributeFilter:["class"]});

lock.querySelector("#pinForgotBtn").addEventListener("click", () => lock.querySelector("#pinForgot").classList.add("open"));
lock.querySelector("#pinForgotNo").addEventListener("click", () => { lock.querySelector("#pinForgot").classList.remove("open"); wipeArmed = false; lock.querySelector("#pinWipe").textContent = "Borrar mis datos y quitar el PIN"; });
lock.querySelector("#pinWipe").addEventListener("click", e => {
  if(!wipeArmed){ wipeArmed = true; e.target.textContent = "Toca otra vez para borrar todo"; return; }
  try{ localStorage.clear(); }catch(err){}
  location.reload();
});

/* Pedir el PIN al abrir y al volver después de 30 s. Mientras la app está en segundo
   plano se tapa el contenido para que no se vea en el selector de apps. */
let hiddenAt = 0;
if(stored()) openLock("unlock");
document.addEventListener("visibilitychange", () => {
  if(!stored()) return;
  if(document.hidden){ hiddenAt = Date.now(); if(!lock.classList.contains("open")) cover.classList.add("open"); }
  else{
    if(lock.classList.contains("open")) return;
    if(Date.now() - hiddenAt > GRACE_MS) openLock("unlock"); else cover.classList.remove("open");
  }
});

/* ---------- Ajustes > Seguridad ---------- */
const secCard = document.getElementById("secCard"), lockSw = document.getElementById("lockSw");
if(secCard && lockSw){
  const t = secCard.querySelector(".toggle .sub");
  if(t) t.innerHTML = '<b style="color:var(--ink)">Pedir PIN</b><br>Al abrir la app y al volver a ella después de 30 segundos. El PIN tapa la app; para cuidar tus datos, también ponle código a tu iPhone.';
  lockSw.setAttribute("aria-label", "Pedir PIN");
  const show = () => { secCard.hidden = false; lockSw.checked = !!stored(); };
  show();
  // index.html vuelve a ocultar la tarjeta al dibujar Ajustes; la mostramos siempre.
  new MutationObserver(show).observe(secCard, {attributes:true, attributeFilter:["hidden"]});
  lockSw.addEventListener("change", () => {
    const want = lockSw.checked;
    lockSw.checked = !want; // no cambia hasta confirmar
    if(want) openLock("create", ok => { lockSw.checked = !!stored(); if(ok) toast("PIN activado"); });
    else openLock("off", ok => { lockSw.checked = !!stored(); if(ok) toast("PIN desactivado"); });
  });
}

/* ---------- Respaldo: compartir, guardar como archivo y restaurar desde archivo ---------- */
const copyBk = document.getElementById("copyBk");
if(copyBk){
  const fresh = copyBk.cloneNode(true); // quita el comportamiento de Android
  copyBk.replaceWith(fresh);
  fresh.textContent = "Compartir respaldo";
  fresh.addEventListener("click", async () => {
    const txt = backupText();
    if(navigator.share){
      try{ await navigator.share({title:"Respaldo de Alcancía", text:txt}); return; }
      catch(e){ if(e && e.name === "AbortError") return; }
    }
    try{ await navigator.clipboard.writeText(txt); toast("Respaldo copiado. Pégalo en una nota."); }
    catch(e){ $("importBox").hidden = false; $("importTxt").value = txt; $("importTxt").select(); toast("Selecciona el texto y cópialo"); }
  });
  const row = document.createElement("div");
  row.className = "grid2"; row.style.marginTop = "10px";
  row.innerHTML = '<button class="btn ghost" type="button" id="saveBkFile">Guardar archivo</button>'
                + '<button class="btn ghost" type="button" id="loadBkFile">Abrir archivo</button>'
                + '<input type="file" id="bkFileIn" accept=".json,.txt,application/json,text/plain" hidden>';
  fresh.parentElement.after(row);
  const p = fresh.closest(".card").querySelector(".sub");
  if(p) p.textContent = "Tus datos solo están en este teléfono. Guarda un respaldo cada cierto tiempo (por ejemplo en Archivos o iCloud Drive) y antes de cambiar de teléfono.";
  document.getElementById("saveBkFile").addEventListener("click", async () => {
    const d = new Date(), name = `alcancia-respaldo-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.json`;
    const file = new File([backupText()], name, {type:"application/json"});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], title:"Respaldo de Alcancía"}); return; }
      catch(e){ if(e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Respaldo guardado");
  });
  const fileIn = document.getElementById("bkFileIn");
  document.getElementById("loadBkFile").addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = "";
    if(!f) return;
    if(f.size > 5e6){ toast("Ese archivo es demasiado grande"); return; }
    doImport(await f.text());
  });
}

/* ---------- Instrucciones para instalar en iPhone ---------- */
const inst = document.getElementById("installCard");
if(inst){
  if(standalone) inst.hidden = true;
  else{
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    inst.querySelector(".sub").innerHTML = isIOS
      ? "En Safari toca <b>Compartir</b> (o el menú <b>···</b> y luego Compartir), elige <b>Agregar a pantalla de inicio</b>, deja activado <b>Abrir como app web</b> y toca <b>Agregar</b>."
      : "Abre esta página en el navegador de tu teléfono y elige “Agregar a la pantalla principal” en el menú.";
  }
}

/* ---------- Sonido en Safari: se activa con el primer toque ---------- */
const unlockAudio = () => {
  try{
    if(S.music === false) return;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if(actx.state === "suspended") actx.resume();
    const b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
  }catch(e){}
};
["touchend","click"].forEach(ev => document.addEventListener(ev, unlockAudio, {passive:true}));

/* ---------- Sin internet y que iOS no borre los datos ---------- */
if("serviceWorker" in navigator && location.protocol !== "file:"){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(() => {}); }
})();
