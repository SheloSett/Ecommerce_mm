// Tests de los estilos de los banners de anuncio (bannerTheme.js). Correr con: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BANNER_THEMES, bannerTheme } from "./bannerTheme.js";

describe("estilo de un banner", () => {
  test("un banner guardado sin estilo sigue siendo normal", () => {
    assert.equal(bannerTheme({ text: "Hola", bgColor: "red" }).key, "normal");
  });

  test("un estilo que no existe cae en normal", () => {
    assert.equal(bannerTheme({ theme: "navidad-2019" }).key, "normal");
    assert.equal(bannerTheme(null).key, "normal");
  });

  test("devuelve el estilo elegido", () => {
    assert.equal(bannerTheme({ theme: "cybermonday" }).label, "Cyber Monday");
  });
});

describe("lista de estilos", () => {
  test("cada estilo tiene nombre, ícono y descripción, y las claves no se repiten", () => {
    for (const t of BANNER_THEMES) {
      assert.ok(t.label && t.icon && t.hint, `incompleto: ${t.key}`);
    }
    assert.equal(new Set(BANNER_THEMES.map((t) => t.key)).size, BANNER_THEMES.length);
  });

  test("cada estilo especial tiene su fondo en el CSS (si no, la letra blanca queda sobre la página)", () => {
    const css = readFileSync(new URL("../components/category-cards.css", import.meta.url), "utf8");
    for (const t of BANNER_THEMES.filter((x) => x.key !== "normal")) {
      assert.match(css, new RegExp(`\\.cc-${t.key}[ ,{]`), `sin CSS: ${t.key}`);
    }
  });
});
