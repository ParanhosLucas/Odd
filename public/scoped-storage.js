// Guarda os dados do navegador (seleção, ligas fixadas, valor, registro) separados por usuário,
// para duas pessoas no mesmo computador não verem o cupom uma da outra.
export function scopedStorage(storage, scope) {
  const prefix = `u:${String(scope).toLowerCase()}:`;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}
