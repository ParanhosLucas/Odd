const $ = (id) => document.getElementById(id);
let data = null, day = 0, filter = "all";

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
    return `<h2>${l.name}</h2>` + ms.map((m) => `
      <div class="m">
        <div><div class="t">${m.home} × ${m.away}${m.live ? '<span class="live">AO VIVO</span>' : ""}</div><div class="when">${fmtTime(m.startTime)}</div></div>
        <div class="o">${cell("1", "home", m.odds)}${cell("X", "draw", m.odds)}${cell("2", "away", m.odds)}</div>
      </div>`).join("");
  }).join("");
  $("list").innerHTML = html || "<p>Nenhum jogo encontrado.</p>";
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
    const next = await (await fetch(`/api/odds?day=${day}`)).json();
    data = next;
    render();
    updateDays();
    const b = $("banner");
    b.hidden = next.source !== "demo";
    if (!b.hidden) b.textContent = `Mostrando dados de DEMONSTRAÇÃO (não são odds reais). Motivo: ${next.error}`;
    $("status").textContent = "Atualizado " + new Date(next.updatedAt).toLocaleTimeString("pt-BR");
  } catch {
    $("status").textContent = "Falha ao atualizar";
  }
}

$("q").addEventListener("input", render);
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
