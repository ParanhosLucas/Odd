import { scopedStorage } from "/scoped-storage.js";
import { buildMessage, whatsappUrl, parseStake, formatBRL, payoutCents, totalReturnCents, MAX_SELECTED, MAX_LINK_LENGTH } from "/share.js";
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

const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

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
  return `<button type="button" class="odd${on ? " on" : ""}" data-id="${esc(m.id)}" data-key="${key}" data-league="${esc(m.__league)}" aria-pressed="${on ? "true" : "false"}" title="Escolher esta odd"><small>${label}</small><b class="${cls}">${arrow}${v.toFixed(2)}</b>${ret}</button>`;
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

function render() {
  if (!data) return;
  const q = $("q").value.trim().toLowerCase();
  const html = data.leagues.map((l) => {
    if (leagueFilter && leagueId(l) !== leagueFilter) return "";
    const ms = l.matches.map((m) => ({ ...m, __league: l.name })).filter((m) => !q || `${l.name} ${m.home} ${m.away}`.toLowerCase().includes(q));
    if (!ms.length) return "";
    const pin = toPinned(l), isPinned = pinned.some((p) => p.id === pin.id);
    return `<h2><span class="lh">${flag(l.country)}<span>${esc(l.name)}</span></span><button type="button" class="pin${isPinned ? " on" : ""}" data-pin="${esc(pin.id)}" data-title="${esc(pin.title)}" data-country="${esc(pin.country || "")}" aria-pressed="${isPinned}" title="${isPinned ? "Desafixar liga" : "Fixar liga"}">${PIN_SVG}</button></h2>` + ms.map((m) => `
      <div class="m${selected.has(m.id) ? " sel" : ""}">
        <label class="pick" title="Selecionar jogo"><input type="checkbox" data-id="${esc(m.id)}" data-league="${esc(l.name)}"${selected.has(m.id) ? " checked" : ""} aria-label="Selecionar ${esc(m.home)} × ${esc(m.away)}"></label>
        <div><div class="t">${esc(m.home)} × ${esc(m.away)}</div><div class="when">${fmtTime(m.startTime)}</div></div>
        <div class="o">${cell("Casa", "home", m)}${cell("Empate", "draw", m)}${cell("Fora", "away", m)}</div>
      </div>`).join("");
  }).join("");
  $("list").innerHTML = html || "<p>Nenhum jogo encontrado.</p>";
  renderSide();
  updateBar();
}

function updateBar(note) {
  const n = selected.size;
  $("bar").hidden = n === 0;
  $("count").textContent = note || `${n} jogo${n === 1 ? "" : "s"} selecionado${n === 1 ? "" : "s"}`;
  const total = stakeCents ? totalReturnCents([...selected.values()], stakeCents) : 0;
  $("total").hidden = !total;
  $("total").innerHTML = total ? `Retorno Total: <b>${formatBRL(total)}</b>` : "";
  // Mostra o registro enquanto o cupom for o mesmo que foi enviado/copiado; mudou algo, some.
  const reg = n ? currentRegistration(store, slipKey([...selected.values()], stakeCents)) : null;
  $("reg").hidden = !reg;
  $("reg").innerHTML = reg ? `Registro: <b>${reg}</b>` : "";
}

// Seleciona o jogo (se ainda não estiver) e devolve o item; null se estourou o limite.
function ensureSelected(id, leagueName) {
  if (selected.has(id)) return selected.get(id);
  const league = data?.leagues.find((l) => l.name === leagueName);
  const match = league?.matches.find((m) => m.id === id);
  if (!match) return null;
  if (selected.size >= MAX_SELECTED) { updateBar(`Máximo de ${MAX_SELECTED} jogos por mensagem`); return null; }
  const item = { league: league.name, match, picks: [] };
  selected.set(id, item);
  return item;
}

function togglePick(btn) {
  const item = ensureSelected(btn.dataset.id, btn.dataset.league);
  if (!item) return;
  const key = btn.dataset.key;
  item.picks = item.picks.includes(key) ? item.picks.filter((k) => k !== key) : [...item.picks, key];
  persist();
  render();
}

function toggle(input) {
  const id = input.dataset.id;
  if (!input.checked) selected.delete(id);
  else {
    if (!ensureSelected(id, input.dataset.league)) { input.checked = false; return; }
  }
  persist();
  render();
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

function setDay(d) {
  day = d; data = null;
  $("list").innerHTML = "<p>Carregando…</p>";
  updateDays();
  load();
}

async function load() {
  try {
    const res = await fetch(`/api/odds?day=${day}`);
    if (res.status === 401) return void location.replace("/login.html"); // sessão expirou ou foi encerrada
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const next = await res.json();
    if (next.day !== day) return; // resposta de um dia que já não está selecionado
    data = next;
    purgeStarted(next.leagues);
    refreshSelected(next.leagues);
    render();
    updateDays();
    const b = $("banner");
    b.hidden = next.source !== "demo" && !next.stale;
    if (next.source === "demo") b.textContent = `Mostrando dados de DEMONSTRAÇÃO (não são odds reais). Motivo: ${next.error}`;
    else if (next.stale) b.textContent = `Flashscore indisponível; mostrando as últimas odds obtidas (${new Date(next.updatedAt).toLocaleTimeString("pt-BR")}).`;
    $("status").textContent = "Atualizado " + new Date(next.updatedAt).toLocaleTimeString("pt-BR");
  } catch (e) {
    $("status").textContent = "Falha ao atualizar: " + e.message;
  }
}

$("q").addEventListener("input", render);
$("list").addEventListener("change", (e) => e.target.matches("input[data-id]") && toggle(e.target));
$("list").addEventListener("click", (e) => {
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
$("clear").onclick = () => { selected.clear(); persist(); render(); };
$("stake").addEventListener("input", (e) => {
  stakeCents = parseStake(e.target.value);
  e.target.classList.toggle("bad", e.target.value.trim() !== "" && stakeCents === null);
  try { store.setItem(STAKE_KEY, e.target.value); } catch {}
  render();
});
try { $("stake").value = store.getItem(STAKE_KEY) || ""; stakeCents = parseStake($("stake").value); } catch {}

$("send").onclick = () => {
  if (!selected.size) return;
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
  if (!selected.size) return;
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
$("prev").onclick = () => setDay(day - 1);
$("next").onclick = () => setDay(day + 1);
updateDays();
load();
setInterval(load, 30_000);
