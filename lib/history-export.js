// Exportação do histórico para planilha (CSV) ou arquivo (JSON). Só o administrador baixa.
import { formatDateTime, ACTION_LABEL } from "../public/history-view.js";

export const CSV_HEADER = ["id", "data_hora_brasilia", "data_hora_utc", "usuario", "aposta", "acao", "registro", "resumo"];

// Planilhas executam texto que começa com = + - @ como fórmula: o resumo vem do navegador, então é neutralizado.
const cell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvRow = (e) => [e.id, formatDateTime(e.createdAt), e.createdAt, e.username, e.slipId, ACTION_LABEL[e.action] ?? e.action, e.registration, e.summary].map(cell).join(",");
export const csvHeader = () => CSV_HEADER.join(",");
