import { buildMessage, whatsappUrl, MAX_SELECTED } from "/share.js";

const $ = (id) => document.getElementById(id);
let data = null, day = 0, filter = "all";

// Jogos selecionados: id -> { league, match } (guarda o jogo inteiro para sobreviver à troca de dia).
const selected = new Map();
const STORE = "odd.selected";
try { for (const it of JSON.parse(localStorage.getItem(STORE) || "[]")) selected.set(it.match.id, it); } catch {}
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify([...selected.values()])); } catch {} };

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

function cell(label, key, odds) {
  const v = odds?.[key];
  if (v == null) return `<div><small>${label}</small><b>—</b></div>`;
  const p = odds.prev?.[key];
  const cls = p == null || p === v ? "" : v > p ? "up" : "down";
  const arrow = cls === "up" ? "↑ " : cls === "down" ? "↓ " : "";
  return `<div><small>${label}</small><b class="${cls}">${arrow}${v.toFixed(2)}</b></div>`;
}

function render() {
  if (!data) return;
  const q = $("q").value.trim().toLowerCase();
  const html = data.leagues.map((l) => {
    const ms = l.matches.filter((m) => (filter === "all" || (filter === "live") === m.live) && (!q || `${l.name} ${m.home} ${m.away}`.toLowerCase().includes(q)));
    if (!ms.length) return "";
    return `<h2>${esc(l.name)}</h2>` + ms.map((m) => `
      <div class="m${selected.has(m.id) ? " sel" : ""}">
        <label class="pick" title="Selecionar jogo"><input type="checkbox" data-id="${esc(m.id)}" data-league="${esc(l.name)}"${selected.has(m.id) ? " checked" : ""} aria-label="Selecionar ${esc(m.home)} × ${esc(m.away)}"></label>
        <div><div class="t">${esc(m.home)} × ${esc(m.away)}${m.live ? '<span class="live">AO VIVO</span>' : ""}</div><div class="when">${fmtTime(m.startTime)}</div></div>
        <div class="o">${cell("1", "home", m.odds)}${cell("X", "draw", m.odds)}${cell("2", "away", m.odds)}</div>
      </div>`).join("");
  }).join("");
  $("list").innerHTML = html || "<p>Nenhum jogo encontrado.</p>";
  updateBar();
}

function updateBar(note) {
  const n = selected.size;
  $("bar").hidden = n === 0;
  $("count").textContent = note || `${n} jogo${n === 1 ? "" : "s"} selecionado${n === 1 ? "" : "s"}`;
}

function toggle(input) {
  const id = input.dataset.id;
  if (!input.checked) selected.delete(id);
  else {
    const league = data?.leagues.find((l) => l.name === input.dataset.league);
    const match = league?.matches.find((m) => m.id === id);
    if (!match) return;
    if (selected.size >= MAX_SELECTED) {
      input.checked = false;
      return updateBar(`Máximo de ${MAX_SELECTED} jogos por mensagem`);
    }
    selected.set(id, { league: league.name, match });
  }
  persist();
  input.closest(".m").classList.toggle("sel", input.checked);
  updateBar();
}

// Mantém os jogos selecionados atualizados com as odds mais recentes.
function refreshSelected(leagues) {
  for (const l of leagues) for (const m of l.matches) if (selected.has(m.id)) selected.set(m.id, { league: l.name, match: m });
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
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const next = await res.json();
    if (next.day !== day) return; // resposta de um dia que já não está selecionado
    data = next;
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
$("clear").onclick = () => { selected.clear(); persist(); render(); };
$("send").onclick = () => {
  if (!selected.size) return;
  window.open(whatsappUrl(buildMessage([...selected.values()])), "_blank", "noopener");
};
$("prev").onclick = () => setDay(day - 1);
$("next").onclick = () => setDay(day + 1);
$("filters").addEventListener("click", (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  filter = f;
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b === e.target));
  render();
});
updateDays();
load();
setInterval(load, 30_000);
