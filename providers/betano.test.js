import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./betano.js";

test("normaliza evento com mercado 1X2", () => {
  const out = normalize({ data: { blocks: [{ name: "Liga X", events: [{
    id: 1, name: "A - B", startTime: 1760000000000,
    markets: [{ type: "MRES", selections: [{ price: "2,10" }, { price: 3.3 }, { price: 3.4 }] }],
  }] }] } });
  assert.equal(out[0].matches[0].odds.home, 2.1);
  assert.equal(out[0].matches[0].home, "A");
});

test("ignora eventos sem 1X2", () => {
  assert.deepEqual(normalize({ blocks: [{ events: [{ name: "A - B", markets: [] }] }] }), []);
});
