// Nomes dos perfis mostrados na tela. Os valores guardados (user/admin) NÃO mudam: só o rótulo.
export const ROLE_LABELS = { user: "Vendedor", admin: "Administrador" };
export const roleLabel = (role) => ROLE_LABELS[role] ?? role;
