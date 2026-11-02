// Tests del guardado de los banners de anuncio (announcementBanners.js). Correr con: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bannerToggled, bannersChanged } from "./announcementBanners.js";

const saved = [
  { id: "1", active: true, text: "Uno" },
  { id: "2", active: true, text: "Dos" },
];

describe("prender o apagar un banner", () => {
  test("cambia solo ese banner", () => {
    assert.deepEqual(bannerToggled(saved, "2", false), [
      { id: "1", active: true, text: "Uno" },
      { id: "2", active: false, text: "Dos" },
    ]);
  });

  test("no modifica la lista que recibe", () => {
    bannerToggled(saved, "2", false);
    assert.equal(saved[1].active, true);
  });

  test("un banner que nunca se guardó no se publica", () => {
    assert.equal(bannerToggled(saved, "nuevo", false), null);
  });
});

describe("cambios sin guardar", () => {
  test("misma lista: no hay cambios", () => {
    assert.equal(bannersChanged([...saved], saved), false);
  });

  test("texto editado o banner agregado: hay cambios", () => {
    assert.equal(bannersChanged([{ ...saved[0], text: "Otro" }, saved[1]], saved), true);
    assert.equal(bannersChanged([...saved, { id: "3" }], saved), true);
  });
});
