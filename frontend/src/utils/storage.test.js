// Tests del acceso al almacenamiento (utils/storage.js): nunca tira, aunque el navegador no deje usarlo.
// Correr con: npm test (en frontend)
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const blockStorage = () => {
  Object.defineProperty(globalThis.window, "localStorage", { configurable: true, get() { throw new Error("Access is denied for this document"); } });
};
globalThis.window = { localStorage: fakeLocalStorage() };
const { storageGet, storageSet, storageRemove, storageGetJSON, isPlainObject } = await import("./storage.js");

describe("almacenamiento del navegador", () => {
  beforeEach(() => {
    globalThis.window = { localStorage: fakeLocalStorage() };
    for (const k of ["k", "otra"]) storageRemove(k); // también vacía lo que quedó en memoria
  });

  test("guarda, lee y borra", () => {
    assert.equal(storageSet("k", "1"), true);
    assert.equal(storageGet("k"), "1");
    storageRemove("k");
    assert.equal(storageGet("k"), null);
  });

  test("con el almacenamiento bloqueado (tocarlo tira) no tira, y recuerda en memoria", () => {
    blockStorage();
    assert.equal(storageGet("k"), null);
    assert.equal(storageSet("k", "2"), false);
    assert.equal(storageGet("k"), "2");
    storageRemove("k");
    assert.equal(storageGet("k"), null);
  });

  test("si guardar falla (cuota llena) sin nada guardado, el valor queda en memoria", () => {
    globalThis.window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    assert.equal(storageSet("k", "nuevo"), false);
    assert.equal(storageGet("k"), "nuevo");
  });

  test("lo guardado en el navegador manda sobre la memoria (otra pestaña pudo cambiarlo)", () => {
    blockStorage();
    storageSet("k", "en-memoria");
    globalThis.window = { localStorage: fakeLocalStorage() };
    assert.equal(storageGet("k"), "en-memoria"); // el navegador no tiene nada todavía
    globalThis.window.localStorage.setItem("k", "de-otra-pestaña");
    assert.equal(storageGet("k"), "de-otra-pestaña");
    globalThis.window.localStorage.removeItem("k");
    assert.equal(storageGet("k"), null); // y la memoria ya se descartó
  });

  test("JSON: lo roto, lo que no está y lo que no pasa el control de forma dan null", () => {
    storageSet("k", "{no es json");
    assert.equal(storageGetJSON("k"), null);
    storageSet("k", '{"a":1}');
    assert.deepEqual(storageGetJSON("k"), { a: 1 });
    assert.equal(storageGetJSON("k", Array.isArray), null);
    assert.deepEqual(storageGetJSON("k", isPlainObject), { a: 1 });
    storageSet("k", "[1,2]");
    assert.deepEqual(storageGetJSON("k", Array.isArray), [1, 2]);
    assert.equal(storageGetJSON("k", isPlainObject), null);
    assert.equal(storageGetJSON("no-existe"), null);
  });

  test("isPlainObject", () => {
    assert.deepEqual([{}, [], "x", 5, null, undefined].map(isPlainObject), [true, false, false, false, false, false]);
  });
});
