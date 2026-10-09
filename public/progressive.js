// Desenha uma lista longa em partes: as primeiras itens já na primeira pintura (a tela responde na hora)
// e o resto em fatias, uma por quadro. Cada item é uma função que devolve o HTML, chamada só no
// momento de escrever (assim o resto da lista nunca aparece com um estado antigo da seleção).
// Chamar de novo cancela as fatias pendentes da chamada anterior.
export function createProgressiveRenderer({ target, firstCount = 60, chunkSize = 150, schedule = (fn) => requestAnimationFrame(fn) }) {
  let token = 0;
  return function render(items, emptyHtml = "") {
    const mine = ++token;
    if (!items.length) { target.innerHTML = emptyHtml; return; }
    target.innerHTML = items.slice(0, firstCount).map((fn) => fn()).join("");
    let next = firstCount;
    const step = () => {
      if (mine !== token) return; // uma desenhada mais nova assumiu
      target.insertAdjacentHTML("beforeend", items.slice(next, next + chunkSize).map((fn) => fn()).join(""));
      next += chunkSize;
      if (next < items.length) schedule(step);
    };
    if (next < items.length) schedule(step);
  };
}
