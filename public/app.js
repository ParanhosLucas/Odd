import { scopedStorage } from "/scoped-storage.js";
import { createDayCache } from "/day-cache.js";
import { createProgressiveRenderer } from "/progressive.js";
import { buildMessage, whatsappUrl, parseStake, formatBRL, payoutCents, totalReturnCents, canSend, minGamesHint, MAX_SELECTED, MAX_LINK_LENGTH } from "/share.js";
import { COUNTRY_FLAG } from "/countries.js";
import { register, currentRegistration, slipKey } from "/register.js";
import { leagueId, loadPinned, savePinned, toPinned, togglePinned } from "/leagues.js";

const $ = (id) => document.getElementById(id);

// Quem está logado? Sem sessão, volta para o login. Os dados do navegador são guardados por usuário.
const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!me) { location.replace("/login.html"); await new Promise(() => {}); }
const store = scopedStorage(localStorage, me.username);
$("who").textContent = me.username;
$("adminLink").hidden = me.role !== "admin";
$("logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  location.replace("/login.html");
};
let data = null, day = 0;
let matchIndex = new Map(); // id do jogo -> { m, leagueName } (busca instantânea; evita varrer a lista toda)
function setData(next) {
  data = next;
  matchIndex = new Map();
  for (const l of next?.leagues ?? []) for (const m of l.matches) matchIndex.set(m.id, { m, leagueName: l.name });
}

let pinned = loadPinned(store);   // ligas fixadas: [{ id, title, country }]
let leagueFilter = null;                 // id da liga escolhida no menu (ou null = todas)

const PIN_SVG = '<svg class="pinicon" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.8 1.2 14.8 6.2 13.4 7.6l-1-.4-2.3 2.3.2 2.6-1.1 1.1-2.6-2.6-3.9 3.9-.7-.7 3.9-3.9L2.3 7.3l1.1-1.1 2.6.2 2.3-2.3-.4-1z"/></svg>';

// Jogos selecionados: id -> { league, match, picks }. Guarda o jogo inteiro para sobreviver à troca de dia;
// picks = odds escolhidas ("home"/"draw"/"away"); vazio = as três vão na mensagem.
const selected = new Map();
const STORE = "odd.selected";
try { for (const it of JSON.parse(store.getItem(STORE) || "[]")) selected.set(it.match.id, { picks: [], ...it }); } catch {}
// Valor da aposta (em centavos); o texto digitado fica guardado para reaparecer ao recarregar.
const STAKE_KEY = "odd.stake";
let stakeCents = null;
const persist = () => { try { store.setItem(STORE, JSON.stringify([...selected.values()])); } catch {} };

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Formatador criado UMA vez: criar um novo a cada jogo era um dos custos de desenhar a lista.
const timeFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : "");

function cell(label, key, m) {
  const odds = m.odds;
  const v = odds?.[key];
  if (v == null) return `<div class="odd"><small>${label}</small><b>—</b></div>`;
  const p = odds.prev?.[key];
  const cls = p == null || p === v ? "" : v > p ? "up" : "down";
  const arrow = cls === "up" ? "↑ " : cls === "down" ? "↓ " : "";
  const item = selected.get(m.id);
  const on = item?.picks.includes(key);
  // Retorno (aposta × odd) só nas odds que você escolheu (clicou); marcar apenas o jogo não calcula nada.
  const ret = stakeCents && on ? `<em class="ret">${formatBRL(payoutCents(stakeCents, v))}</em>` : "";
  return `<button type="button" class="odd${on ? " on" : ""}" data-id="${esc(m.id)}" data-key="${key}" aria-pressed="${on ? "true" : "false"}" title="Escolher esta odd"><small>${label}</small><b class="${cls}">${arrow}${v.toFixed(2)}</b>${ret}</button>`;
}

function flag(country) {
  const code = COUNTRY_FLAG[country];
  // Regiões (Europa, Mundo, América do Sul…) e países sem bandeira usam o ícone de mundo.
  return `<img class="flag" src="/flags/${code || "world"}.svg" alt="" loading="lazy">`;
}

function renderSide() {
  $("pinned").innerHTML = pinned.length
    ? pinned.map((p) => `<li class="${leagueFilter === p.id ? "on" : ""}">
          <button type="button" class="lg" data-lg="${esc(p.id)}" aria-pressed="${leagueFilter === p.id}" title="${esc(p.title)}">${flag(p.country)}<span class="lg-name">${esc(p.title)}</span></button>
          <button type="button" class="unpin" data-unpin="${esc(p.id)}" aria-label="Desafixar ${esc(p.title)}" title="Desafixar">×</button>
        </li>`).join("")
    : '<li class="pin-empty">Nenhuma liga fixada. Use o alfinete ao lado do nome de uma liga.</li>';
  const note = $("leagueNote"), active = pinned.find((p) => p.id === leagueFilter);
  note.hidden = !active;
  if (active) note.innerHTML = `${flag(active.country)}<span>Mostrando só <b>${esc(active.title)}</b></span><button type="button" data-clear-league>Ver todas as ligas</button>`;
}

function headerHtml(l) {
  const pin = toPinned(l), isPinned = pinned.some((p) => p.id === pin.id);
  return `<h2><span class="lh">${flag(l.country)}<span>${esc(l.name)}</span></span><button type="button" class="pin${isPinned ? " on" : ""}" data-pin="${esc(pin.id)}" data-title="${esc(pin.title)}" data-country="${esc(pin.country || "")}" aria-pressed="${isPinned}" title="${isPinned ? "Desafixar liga" : "Fixar liga"}">${PIN_SVG}</button></h2>`;
}

function cardHtml(m) {
  const sel = selected.has(m.id);
  return `<div class="m${sel ? " sel" : ""}">
        <label class="pick" title="Selecionar jogo"><input type="checkbox" data-id="${esc(m.id)}"${sel ? " checked" : ""} aria-label="Selecionar ${esc(m.home)} × ${esc(m.away)}"></label>
        <div><div class="t">${esc(m.home)} × ${esc(m.away)}</div><div class="when">${fmtTime(m.startTime)}</div></div>
        <div class="o">${cell("Casa", "home", m)}${cell("Empate", "draw", m)}${cell("Fora", "away", m)}</div>
      </div>`;
}

// A lista longa (centenas de jogos) é desenhada em partes: os primeiros já na primeira pintura, o resto por quadro.
const drawList = createProgressiveRenderer({ target: $("list") });

function render() {
  if (!data) return;
  $("list").removeAttribute("aria-busy");
  const q = $("q").value.trim().toLowerCase();
  const items = [];
  for (const l of data.leagues) {
    if (leagueFilter && leagueId(l) !== leagueFilter) continue;
    const ms = q ? l.matches.filter((m) => `${l.name} ${m.home} ${m.away}`.toLowerCase().includes(q)) : l.matches;
    if (!ms.length) continue;
    items.push(() => headerHtml(l));
    for (const m of ms) items.push(() => cardHtml(m));
  }
  drawList(items, "<p>Nenhum jogo encontrado.</p>");
  renderSide();
  updateBar();
}

// Atualiza SÓ o cartão de um jogo (em vez de refazer a lista inteira a cada clique).
const cardElement = (id) => $("list").querySelector(`input[data-id="${CSS.escape(id)}"]`)?.closest(".m") ?? null;
function replaceCard(id, focusSelector) {
  const el = cardElement(id), hit = matchIndex.get(id);
  if (!el || !hit) return; // jogo de outro dia ou ainda não desenhado: não há o que atualizar na tela
  el.outerHTML = cardHtml(hit.m);
  if (focusSelector) cardElement(id)?.querySelector(focusSelector)?.focus(); // quem usa teclado não perde o foco
}
const refreshSelectedCards = () => { for (const id of selected.keys()) replaceCard(id); };

// A página reserva no fim exatamente a altura da barra (muda com o tamanho da tela, avisos e quebras de linha).
const barEl = $("bar");
new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", barEl.hidden ? "0px" : `${barEl.offsetHeight}px`)).observe(barEl);

function updateBar(note) {
  const n = selected.size;
  $("bar").hidden = n === 0;
  $("count").textContent = note || `${n} jogo${n === 1 ? "" : "s"} selecionado${n === 1 ? "" : "s"}`;
  // Enviar e copiar (que serve só para colar no WhatsApp) exigem o mínimo de jogos.
  const ok = canSend(n);
  $("send").disabled = !ok;
  $("copy").disabled = !ok;
  $("minHint").hidden = n === 0 || ok;
  $("minHint").textContent = n === 0 || ok ? "" : minGamesHint(n);
  const total = stakeCents ? totalReturnCents([...selected.values()], stakeCents) : 0;
  $("total").hidden = !total;
  $("total").innerHTML = total ? `Retorno Total: <b>${formatBRL(total)}</b>` : "";
  // Mostra o registro enquanto o cupom for o mesmo que foi enviado/copiado; mudou algo, some.
  const reg = n ? currentRegistration(store, slipKey([...selected.values()], stakeCents)) : null;
  $("reg").hidden = !reg;
  $("reg").innerHTML = reg ? `Registro: <b>${reg}</b>` : "";
}

// Seleciona o jogo (se ainda não estiver) e devolve o item; null se estourou o limite.
function ensureSelected(id) {
  if (selected.has(id)) return selected.get(id);
  const hit = matchIndex.get(id);
  if (!hit) return null;
  if (selected.size >= MAX_SELECTED) { updateBar(`Máximo de ${MAX_SELECTED} jogos por mensagem`); return null; }
  const item = { league: hit.leagueName, match: hit.m, picks: [] };
  selected.set(id, item);
  return item;
}

function togglePick(btn) {
  const id = btn.dataset.id, key = btn.dataset.key;
  const item = ensureSelected(id);
  if (!item) return;
  item.picks = item.picks.includes(key) ? item.picks.filter((k) => k !== key) : [...item.picks, key];
  persist();
  replaceCard(id, `[data-key="${key}"]`);
  updateBar();
}

function toggle(input) {
  const id = input.dataset.id;
  if (!input.checked) selected.delete(id);
  else if (!ensureSelected(id)) { input.checked = false; return; }
  persist();
  replaceCard(id, ".pick input");
  updateBar();
}

// Jogo selecionado que já começou e saiu da lista (ao vivo/encerrado, não exibidos) é removido da seleção;
// senão ficaria "preso" na barra sem como desmarcar.
function purgeStarted(leagues) {
  const present = new Set(leagues.flatMap((l) => l.matches.map((m) => m.id)));
  let changed = false;
  for (const [id, it] of selected) {
    if (!present.has(id) && Date.parse(it.match.startTime) <= Date.now()) { selected.delete(id); changed = true; }
  }
  if (changed) persist();
}

// Mantém os jogos selecionados atualizados com as odds mais recentes.
function refreshSelected(leagues) {
  for (const l of leagues) for (const m of l.matches) if (selected.has(m.id)) selected.set(m.id, { league: l.name, match: m, picks: selected.get(m.id).picks });
  persist();
}

function dayName(d) {
  const t = new Date(); t.setDate(t.getDate() + d);
  const date = t.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return d === 0 ? `Hoje ${date}` : d === 1 ? `Amanhã ${date}` : `${t.toLocaleDateString("pt-BR", { weekday: "short" })} ${date}`;
}

function updateDays() {
  $("dayLabel").textContent = dayName(day);
  $("prev").disabled = day <= 0;
  $("next").disabled = day >= (data?.maxDay ?? 7);
}

// Busca um dia no servidor. Toda busca (inclusive as de pré-carregamento) já atualiza as odds dos jogos selecionados.
async function fetchDay(d) {
  const res = await fetch(`/api/odds?day=${d}`);
  if (res.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada"); } // expirou ou foi encerrada
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const next = await res.json();
  refreshSelected(next.leagues);
  return next;
}
const dayCache = createDayCache({ fetchDay });

function applyMeta(next) {
  const b = $("banner");
  b.hidden = next.source !== "demo" && !next.stale;
  if (next.source === "demo") b.textContent = `Mostrando dados de DEMONSTRAÇÃO (não são odds reais). Motivo: ${next.error}`;
  else if (next.stale) b.textContent = `Flashscore indisponível; mostrando as últimas odds obtidas (${new Date(next.updatedAt).toLocaleTimeString("pt-BR")}).`;
  $("status").textContent = "Atualizado " + new Date(next.updatedAt).toLocaleTimeString("pt-BR");
}

function applyData(next) {
  setData(next);
  render();
  updateDays();
  applyMeta(next);
}

// Esqueleto no lugar do texto "Carregando…": a página não "pula" e dá a sensação de resposta imediata.
function renderSkeleton() {
  const list = $("list");
  list.setAttribute("aria-busy", "true");
  list.innerHTML = '<h2 class="skel-title" aria-hidden="true"><span class="skel-bar"></span></h2>' + Array.from({ length: 5 }, () =>
    '<div class="m skel" aria-hidden="true"><span class="skel-box"></span><div><span class="skel-bar w60"></span><span class="skel-bar w30"></span></div><div class="o"><span class="skel-pill"></span><span class="skel-pill"></span><span class="skel-pill"></span></div></div>').join("");
}

function showError(e, hadData) {
  $("status").textContent = "Falha ao atualizar: " + e.message;
  if (!hadData) $("list").innerHTML = `<p class="loaderr">Não foi possível carregar este dia (${esc(e.message)}). <button type="button" data-retry>Tentar de novo</button></p>`;
}

// Mostra um dia: o que já temos aparece NA HORA; se estiver velho, atualiza por trás sem esvaziar a tela.
function show(d) {
  day = d;
  updateDays();
  const { cached, refresh } = dayCache.open(d);
  if (cached) { setData(cached); render(); applyMeta(cached); } else { setData(null); renderSkeleton(); $("status").textContent = "Carregando…"; }
  refresh?.then((next) => {
    if (day !== d) return; // o usuário já foi para outro dia
    purgeStarted(next.leagues);
    applyData(next);
  }).catch((e) => { if (day === d) showError(e, Boolean(cached)); });
  // Com o dia atual encaminhado, adianta os vizinhos: o próximo clique já encontra tudo pronto.
  setTimeout(() => dayCache.prefetch([d + 1, d - 1]), 250);
}

// Atualização periódica do dia atual (só com a aba visível, para não gastar o servidor à toa).
function refreshCurrent() {
  if (document.hidden) return;
  const d = day;
  dayCache.load(d).then((next) => {
    if (day !== d) return;
    purgeStarted(next.leagues);
    applyData(next);
  }).catch((e) => { if (day === d) showError(e, Boolean(data)); });
}

let searchTimer;
$("q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); }); // não refaz a lista a cada letra
$("list").addEventListener("change", (e) => e.target.matches("input[data-id]") && toggle(e.target));
$("list").addEventListener("click", (e) => {
  if (e.target.closest("[data-retry]")) return show(day);
  const odd = e.target.closest("button.odd");
  if (odd) return togglePick(odd);
  const pin = e.target.closest("button.pin");
  if (pin) {
    pinned = togglePinned(pinned, { id: pin.dataset.pin, title: pin.dataset.title, country: pin.dataset.country || null });
    savePinned(store, pinned);
    render();
  }
});

// Menu "Ligas fixadas": clicar numa liga filtra a lista; clicar de novo (ou em "Ver todas") limpa.
$("pinnedBox").addEventListener("click", (e) => {
  const un = e.target.closest("[data-unpin]");
  if (un) {
    pinned = pinned.filter((p) => p.id !== un.dataset.unpin);
    if (leagueFilter === un.dataset.unpin) leagueFilter = null;
    savePinned(store, pinned);
    return render();
  }
  const lg = e.target.closest("[data-lg]");
  if (lg) { leagueFilter = leagueFilter === lg.dataset.lg ? null : lg.dataset.lg; render(); }
});
$("leagueNote").addEventListener("click", (e) => { if (e.target.closest("[data-clear-league]")) { leagueFilter = null; render(); } });

// No computador o menu fica aberto ao lado da lista; no celular começa recolhido.
const wide = matchMedia("(min-width: 860px)");
$("pinnedBox").open = wide.matches;
wide.addEventListener("change", (e) => { $("pinnedBox").open = e.matches; });
renderSide();
$("clear").onclick = () => {
  const ids = [...selected.keys()];
  selected.clear();
  persist();
  for (const id of ids) replaceCard(id);
  updateBar();
};
$("stake").addEventListener("input", (e) => {
  stakeCents = parseStake(e.target.value);
  e.target.classList.toggle("bad", e.target.value.trim() !== "" && stakeCents === null);
  try { store.setItem(STAKE_KEY, e.target.value); } catch {}
  refreshSelectedCards(); // só os cartões selecionados mostram retorno
  updateBar();
});
try { $("stake").value = store.getItem(STAKE_KEY) || ""; stakeCents = parseStake($("stake").value); } catch {}

$("send").onclick = () => {
  if (!canSend(selected.size)) return; // o botão já fica desativado; isto cobre qualquer caminho que o ative
  const items = [...selected.values()];
  // Sem emojis: a página wa.me do WhatsApp os exibe como "�". Para ter emojis, use "Copiar mensagem".
  const options = { emojis: false, stakeCents };
  // Confere o tamanho ANTES de registrar, para não gastar um número numa mensagem que não foi enviada.
  if (whatsappUrl(buildMessage(items, { ...options, registration: "000000-0000" })).length > MAX_LINK_LENGTH) {
    updateBar("Mensagem grande demais para o link: use “Copiar mensagem” ou selecione menos jogos.");
    return void setTimeout(() => updateBar(), 5000);
  }
  const number = register(store, slipKey(items, stakeCents));
  window.open(whatsappUrl(buildMessage(items, { ...options, registration: number })), "_blank", "noopener");
  updateBar();
};
$("copy").onclick = async () => {
  if (!canSend(selected.size)) return;
  const items = [...selected.values()];
  const number = register(store, slipKey(items, stakeCents));
  const text = buildMessage(items, { stakeCents, registration: number });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  updateBar(`Mensagem copiada (registro ${number})! Cole no WhatsApp.`);
  setTimeout(() => updateBar(), 2500);
};
for (const ev of ["pointerenter", "focus", "touchstart"]) { // antecipa o dia para onde o usuário vai
  $("prev").addEventListener(ev, () => dayCache.prefetch([day - 1]), { passive: true });
  $("next").addEventListener(ev, () => dayCache.prefetch([day + 1]), { passive: true });
}
$("prev").onclick = () => show(day - 1);
$("next").onclick = () => show(day + 1);
show(0);
setInterval(refreshCurrent, 30_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !dayCache.isFresh(day)) refreshCurrent(); });
