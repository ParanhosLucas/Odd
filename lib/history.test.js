import test from "node:test";
import assert from "node:assert/strict";
import { validateEvents, clampLimit, parseCursor, MAX_EVENTS_PER_REQUEST, MAX_DETAIL_CHARS } from "./history.js";

const ok = (over = {}) => ({ action: "changed", slipId: "slip-abc12345", summary: "Adicionou jogo", detail: { n: 1 }, ...over });

test("evento válido é aceito e normalizado (resumo sem espaços nas pontas, clientAt vira data)", () => {
  const r = validateEvents({ events: [ok({ summary: "  Adicionou jogo  ", clientAt: "2026-10-09T12:00:00.000Z" })] });
  assert.equal(r.ok, true);
  assert.equal(r.events[0].summary, "Adicionou jogo");
  assert.ok(r.events[0].clientAt instanceof Date);
  assert.equal(r.events[0].registration, null);
  assert.deepEqual(r.events[0].detail, { n: 1 });
});

test("todas as ações do navegador são aceitas; ações de administração e desconhecidas, não", () => {
  for (const action of ["created", "changed", "cleared"]) assert.equal(validateEvents({ events: [ok({ action })] }).ok, true, action);
  for (const action of ["sent", "copied"]) assert.equal(validateEvents({ events: [ok({ action, registration: "091026-0001" })] }).ok, true, action);
  for (const action of ["user_created", "user_deleted", "hack", "", null, 5, undefined]) assert.equal(validateEvents({ events: [ok({ action })] }).ok, false, String(action));
});

test("envio e cópia exigem número de registro válido; os demais aceitam sem", () => {
  assert.equal(validateEvents({ events: [ok({ action: "sent" })] }).ok, false);
  assert.equal(validateEvents({ events: [ok({ action: "copied", registration: null })] }).ok, false);
  for (const bad of ["91026-0001", "091026-001", "091026_0001", "abc", "091026-0001; DROP", 5, ""]) assert.equal(validateEvents({ events: [ok({ action: "sent", registration: bad })] }).ok, false, String(bad));
  assert.equal(validateEvents({ events: [ok({ action: "sent", registration: "091026-12345" })] }).ok, true);
  assert.equal(validateEvents({ events: [ok({ registration: "091026-0001" })] }).ok, true);
});

test("slipId: só letras, números, _ e -, de 8 a 64 caracteres", () => {
  for (const bad of ["curto", "tem espaço aqui", "a".repeat(65), "ação-com-acento", "x'; --xxxxx", 123, null, undefined, ""]) assert.equal(validateEvents({ events: [ok({ slipId: bad })] }).ok, false, String(bad));
  for (const good of ["12345678", "a".repeat(64), "3f2a-77aa-bbcc_dd", "550e8400-e29b-41d4-a716-446655440000"]) assert.equal(validateEvents({ events: [ok({ slipId: good })] }).ok, true, good);
});

test("resumo: obrigatório, até 500 caracteres, tem de ser texto", () => {
  for (const bad of ["", "   ", "x".repeat(501), 42, null, undefined, {}, ["a"]]) assert.equal(validateEvents({ events: [ok({ summary: bad })] }).ok, false, JSON.stringify(bad)?.slice(0, 20));
  assert.equal(validateEvents({ events: [ok({ summary: "x".repeat(500) })] }).ok, true);
});

test("detalhe: objeto, no máximo 30 mil caracteres; clientAt precisa ser data válida", () => {
  for (const bad of ["texto", 5, [1, 2], true]) assert.equal(validateEvents({ events: [ok({ detail: bad })] }).ok, false, JSON.stringify(bad));
  assert.equal(validateEvents({ events: [ok({ detail: { m: "x".repeat(MAX_DETAIL_CHARS) } })] }).ok, false);
  assert.equal(validateEvents({ events: [ok({ detail: { m: "x".repeat(MAX_DETAIL_CHARS - 20) } })] }).ok, true);
  assert.equal(validateEvents({ events: [ok({ detail: undefined })] }).ok, true);
  for (const bad of ["ontem", 12345, "", {}]) assert.equal(validateEvents({ events: [ok({ clientAt: bad })] }).ok, false, JSON.stringify(bad));
});

test("lista de eventos: de 1 a 20, formato correto, e um evento ruim derruba o envio inteiro", () => {
  for (const bad of [undefined, null, {}, { events: null }, { events: "x" }, { events: [] }, { events: {} }, { events: [null] }, { events: ["x"] }, { events: [[]] }]) assert.equal(validateEvents(bad).ok, false, JSON.stringify(bad));
  assert.equal(validateEvents({ events: Array.from({ length: MAX_EVENTS_PER_REQUEST }, () => ok()) }).ok, true);
  const demais = validateEvents({ events: Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => ok()) });
  assert.equal(demais.ok, false);
  assert.match(demais.error, /No máximo 20/);
  const misto = validateEvents({ events: [ok(), ok({ action: "hack" }), ok()] });
  assert.equal(misto.ok, false);
  assert.match(misto.error, /Evento 2/); // diz qual evento é o problema
});

test("limite e cursor da listagem: inteiros positivos, com teto; lixo é recusado", () => {
  assert.equal(clampLimit(undefined), 100);
  assert.equal(clampLimit("50"), 50);
  assert.equal(clampLimit("9999"), 300);
  for (const bad of ["0", "-5", "abc", "1.5", "", "10000", "1e3"]) assert.equal(clampLimit(bad), null, bad);
  assert.deepEqual(parseCursor(undefined), { ok: true, value: null });
  assert.deepEqual(parseCursor("42"), { ok: true, value: 42 });
  for (const bad of ["abc", "-1", "1.5", "", "99999999999999"]) assert.equal(parseCursor(bad).ok, false, bad);
});
