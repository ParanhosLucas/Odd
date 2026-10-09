import { groupHistory, formatDateTime, ACTION_LABEL, STATUS_LABEL } from "/history-view.js";

const $ = (id) => document.getElementById(id);
const PAGE = 100;

const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!me) { location.replace("/login.html"); await new Promise(() => {}); }
const isAdmin = me.role === "admin";
$("who").textContent = me.username;
$("adminLink").hidden = !isAdmin;
$("logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  location.replace("/login.html");
};
if (isAdmin) {
  $("userFilterBox").hidden = false;
  $("histTitle").textContent = "Histórico de todos os usuários";
} else {
  $("histTitle").textContent = "Seu histórico de apostas";
}

let events = [], hasMore = false, filter = "", loading = false;

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};
const say = (text) => { $("histMsg").textContent = text; $("histMsg").className = "error"; $("histMsg").hidden = !text; };

function timelineItem(e) {
  const li = el("li", { className: `ev ev-${e.action}` });
  li.append(el("time", { dateTime: e.createdAt, textContent: formatDateTime(e.createdAt) }));
  li.append(el("span", { className: "evtext" }, el("b", { textContent: ACTION_LABEL[e.action] ?? e.action }), document.createTextNode(` — ${e.summary}`)));
  if (e.detail?.message) {
    li.append(el("details", { className: "msg" }, el("summary", { textContent: "Ver mensagem" }), el("pre", { textContent: e.detail.message })));
  }
  return li;
}

function slipCard(s) {
  const reg = s.registrations.length ? s.registrations.join(", ") : "Sem registro";
  const head = el("summary", {},
    el("span", { className: "reg", textContent: reg }),
    el("span", { className: `badge badge-${s.status}`, textContent: STATUS_LABEL[s.status] }),
    isAdmin ? el("span", { className: "by", textContent: s.username }) : null,
    el("span", { className: "span", textContent: `${formatDateTime(s.startedAt)} → ${formatDateTime(s.lastAt)}` }),
  );
  const list = el("ul", { className: "timeline" });
  for (const e of s.events) list.append(timelineItem(e));
  return el("details", { className: "slip" }, head, list);
}

function render() {
  const { slips, admin } = groupHistory(events);
  const open = new Set([...$("slips").querySelectorAll("details.slip[open]")].map((d) => d.dataset.key));
  const frag = document.createDocumentFragment();
  for (const s of slips) {
    const card = slipCard(s);
    card.dataset.key = s.key;
    if (open.has(s.key)) card.open = true;
    frag.append(card);
  }
  $("slips").replaceChildren(...(slips.length ? frag.childNodes : [el("p", { className: "empty", textContent: filter ? "Nenhuma aposta deste usuário." : "Nenhuma aposta registrada ainda." })]));
  $("adminSection").hidden = !isAdmin || admin.length === 0;
  $("adminEvents").replaceChildren(...admin.map((e) => {
    const li = timelineItem(e);
    li.append(el("span", { className: "by", textContent: `por ${e.username}` }));
    return li;
  }));
  $("more").hidden = !hasMore;
  $("more").disabled = loading;
}

async function load(reset) {
  if (loading) return;
  loading = true;
  say("");
  const qs = new URLSearchParams({ limit: String(PAGE) });
  if (!reset && events.length) qs.set("before", String(events.at(-1).id));
  if (isAdmin && filter) qs.set("username", filter);
  try {
    const res = await fetch(`${isAdmin ? "/api/admin/history" : "/api/history"}?${qs}`);
    if (res.status === 401) { location.replace("/login.html"); await new Promise(() => {}); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Não foi possível carregar o histórico.");
    events = reset ? body.events : [...events, ...body.events];
    hasMore = body.hasMore;
    if (isAdmin && body.usernames) {
      const sel = $("userFilter");
      const known = new Set([...sel.options].map((o) => o.value));
      for (const u of body.usernames) if (!known.has(u)) sel.append(new Option(u, u));
    }
  } catch (e) {
    say(e.message || "Não foi possível carregar o histórico.");
  } finally {
    loading = false;
    render();
  }
}

$("more").onclick = () => load(false);
$("userFilter").onchange = (e) => { filter = e.target.value; events = []; hasMore = false; load(true); };
load(true);
