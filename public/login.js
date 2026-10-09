const form = document.getElementById("form");
const error = document.getElementById("error");
const button = form.querySelector("button");

// Já está logado? Vai direto para o site.
fetch("/api/me").then((r) => r.ok && location.replace("/")).catch(() => {});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  button.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (res.ok) return location.replace("/");
    const body = await res.json().catch(() => ({}));
    error.textContent = body.error || `Não foi possível entrar (erro ${res.status}).`;
  } catch {
    error.textContent = "Sem conexão com o servidor. Tente de novo.";
  }
  error.hidden = false;
  form.elements.password.value = "";
  form.elements.password.focus();
  button.disabled = false;
});
