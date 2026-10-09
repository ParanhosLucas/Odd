const $ = (id) => document.getElementById(id);
const JSON_H = { "content-type": "application/json" };
let me = null;

const say = (text, ok = true) => {
  const m = $("msg");
  m.textContent = text;
  m.className = ok ? "ok" : "error";
  m.hidden = !text;
};

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) { location.replace("/login.html"); await new Promise(() => {}); }
  if (res.status === 403) { location.replace("/"); await new Promise(() => {}); }
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const cell = (text) => Object.assign(document.createElement("td"), { textContent: text });

function render(users) {
  const tbody = $("users");
  tbody.replaceChildren();
  for (const u of users) {
    const tr = document.createElement("tr");
    const isMe = u.username === me.username;
    tr.append(cell(isMe ? `${u.username} (você)` : u.username), cell(u.role === "admin" ? "Administrador" : "Usuário"), cell(new Date(u.createdAt).toLocaleString("pt-BR")));
    const td = document.createElement("td");
    if (!isMe) {
      const btn = Object.assign(document.createElement("button"), { type: "button", textContent: "Excluir", className: "danger" });
      btn.onclick = () => remove(u);
      td.append(btn);
    }
    tr.append(td);
    tbody.append(tr);
  }
}

async function load() {
  const r = await api("/api/admin/users");
  if (r.ok) render(r.body.users);
  else say(r.body.error || "Não foi possível carregar os usuários.", false);
}

async function remove(u) {
  if (!confirm(`Excluir o usuário "${u.username}"? Ele será desconectado e não conseguirá mais entrar.`)) return;
  const r = await api(`/api/admin/users/${u.id}`, { method: "DELETE", headers: JSON_H, body: "{}" });
  say(r.ok ? `Usuário "${u.username}" excluído.` : r.body.error || "Não foi possível excluir.", r.ok);
  load();
}

$("create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const r = await api("/api/admin/users", { method: "POST", headers: JSON_H, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  if (r.ok) {
    say(`Usuário "${r.body.user.username}" criado. Entregue a senha a ele.`);
    form.reset();
  } else {
    say(r.body.error || "Não foi possível criar o usuário.", false);
  }
  load();
});

$("logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST", headers: JSON_H, body: "{}" });
  location.replace("/login.html");
};

me = (await api("/api/me")).body;
load();
