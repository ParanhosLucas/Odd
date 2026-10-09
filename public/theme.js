// Tema escuro (preto) / claro (branco). Roda no <head>, de forma bloqueante, para aplicar a escolha
// ANTES de a página ser pintada (senão ela piscaria na cor errada). Sem escolha, segue o sistema.
(() => {
  const KEY = "odd.theme";
  const root = document.documentElement;

  const read = () => {
    try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
  };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  const system = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const current = () => root.dataset.theme || system();

  const saved = read();
  if (saved) root.dataset.theme = saved;

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const paint = () => {
      const mode = current();
      btn.dataset.mode = mode; // o CSS mostra o sol no tema escuro e a lua no claro (o que o clique vai trazer)
      const next = mode === "dark" ? "claro" : "escuro";
      btn.setAttribute("aria-label", `Mudar para o tema ${next}`);
      btn.title = `Mudar para o tema ${next}`;
    };
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      write(next);
      paint();
    });
    // Sem escolha salva, acompanha o sistema se ele mudar (ex.: modo noturno automático).
    matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (!root.dataset.theme) paint(); });
    paint();
  });
})();
