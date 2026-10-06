const $ = (id) => document.getElementById(id);
let data = null;
const prev = new Map();

const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

function cell(label, key, id, v) {
  const p = prev.get(`${id}:${key}`);
  const cls = p == null || p === v ? "" : v > p ? "up" : "down";
  return `<div><small>${label}</small><b class="${cls}">${v.toFixed(2)}</b></div>`;
}

function render() {
  if (!data) return;
  const q = $("q").value.trim().toLowerCase();
  const html = data.leagues.map((l) => {
    const ms = l.matches.filter((m) => !q || `${l.name} ${m.home} ${m.away}`.toLowerCase().includes(q));
    if (!ms.length) return "";
    return `<h2>${l.name}</h2>` + ms.map((m) => `
      <div class="m">
        <div><div class="t">${m.home} × ${m.away}${m.live ? '<span class="live">AO VIVO</span>' : ""}</div><div class="when">${fmtTime(m.startTime)}</div></div>
        <div class="o">${cell("1", "home", m.id, m.odds.home)}${cell("X", "draw", m.id, m.odds.draw)}${cell("2", "away", m.id, m.odds.away)}</div>
      </div>`).join("");
  }).join("");
  $("list").innerHTML = html || "<p>Nenhum jogo encontrado.</p>";
}

async function load() {
  try {
    const next = await (await fetch("/api/odds")).json();
    data = next;
    render();
    for (const l of next.leagues) for (const m of l.matches) for (const k of ["home", "draw", "away"]) prev.set(`${m.id}:${k}`, m.odds[k]);
    const b = $("banner");
    b.hidden = next.source !== "demo";
    if (!b.hidden) b.textContent = `Mostrando dados de DEMONSTRAÇÃO (não são odds reais). Motivo: ${next.error}`;
    $("status").textContent = "Atualizado " + new Date(next.updatedAt).toLocaleTimeString("pt-BR");
  } catch {
    $("status").textContent = "Falha ao atualizar";
  }
}

$("q").addEventListener("input", render);
load();
setInterval(load, 30_000);
