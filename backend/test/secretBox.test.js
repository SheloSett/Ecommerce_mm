// Tests del cifrado de secretos guardados en la base (utils/secretBox.js). Correr con: npm test
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { seal, open, isConfigured, loadKey, SecretBoxError } = require("../src/utils/secretBox");

const key = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);

function code(fn) {
  try { fn(); } catch (err) { assert.ok(err instanceof SecretBoxError, `esperaba SecretBoxError, vino ${err}`); return err.code; }
  assert.fail("esperaba un error");
}

describe("seal / open", () => {
  test("ida y vuelta, también con acentos y vacío", () => {
    for (const text of ["APP_USR-123-abc", "contraseña ñandú 🔒", ""]) {
      assert.equal(open("ml.access_token", seal("ml.access_token", text, { key }), { key }), text);
    }
  });

  test("dos cifrados del mismo texto no se parecen (iv al azar) y no contienen el texto", () => {
    const a = seal("ml.access_token", "APP_USR-secreto", { key });
    const b = seal("ml.access_token", "APP_USR-secreto", { key });
    assert.notEqual(a, b);
    assert.ok(!a.includes("secreto") && !Buffer.from(a.split(".")[3], "base64url").toString().includes("secreto"));
  });

  test("con otra clave no abre", () => {
    const sealed = seal("ml.refresh_token", "TG-123", { key });
    assert.equal(code(() => open("ml.refresh_token", sealed, { key: otherKey })), "CANT_OPEN");
  });

  test("en otro casillero no abre (no se puede mover un token de columna)", () => {
    const sealed = seal("ml.refresh_token", "TG-123", { key });
    assert.equal(code(() => open("ml.access_token", sealed, { key })), "CANT_OPEN");
  });

  test("un dato alterado no abre", () => {
    const sealed = seal("ml.refresh_token", "TG-123456789", { key });
    const parts = sealed.split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 1;
    parts[3] = body.toString("base64url");
    assert.equal(code(() => open("ml.refresh_token", parts.join("."), { key })), "CANT_OPEN");
  });

  test("formatos rotos se rechazan sin intentar descifrar", () => {
    for (const bad of [null, "", "texto en claro", "v2.a.b.c", "v1.a.b", "v1.@@.b.c"]) {
      assert.equal(code(() => open("ml.access_token", bad, { key })), "BAD_FORMAT");
    }
  });

  test("sin clave no cifra ni descifra (nunca guarda en claro)", () => {
    assert.equal(code(() => seal("ml.access_token", "x", { key: null })), "NO_KEY");
    assert.equal(code(() => open("ml.access_token", "v1.a.b.c", { key: null })), "NO_KEY");
  });

  test("casillero inválido", () => {
    assert.equal(code(() => seal("", "x", { key })), "BAD_SLOT");
    assert.equal(code(() => seal("con espacio", "x", { key })), "BAD_SLOT");
  });
});

describe("SECRETS_KEY", () => {
  test("acepta 32 bytes en base64, base64url o hex", () => {
    const raw = crypto.randomBytes(32);
    for (const value of [raw.toString("base64"), raw.toString("base64url"), raw.toString("hex")]) {
      assert.deepEqual(loadKey({ SECRETS_KEY: value }), raw);
      assert.equal(isConfigured({ SECRETS_KEY: value }), true);
    }
  });

  test("rechaza claves de otro largo o vacías", () => {
    for (const value of ["", "corta", crypto.randomBytes(16).toString("base64"), crypto.randomBytes(31).toString("hex")]) {
      assert.equal(loadKey({ SECRETS_KEY: value }), null);
      assert.equal(isConfigured({ SECRETS_KEY: value }), false);
    }
  });
});
