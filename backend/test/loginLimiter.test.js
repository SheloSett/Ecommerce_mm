// Tests de los límites del login de clientes (middleware/customerLoginLimiter.js).
// Correr con: npm test
//
// Se arma una app de prueba con los mismos límites y un login falso ("correcta" entra, cualquier otra
// da 401), escuchando en 127.0.0.1. La IP de cada pedido se simula con X-Forwarded-For.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { loginByIpLimiter, loginByAccountLimiter, resetAccountLoginLimit } = require("../src/middleware/customerLoginLimiter");
const { isCloudflareIp } = require("../src/utils/cloudflareIp");

let server, base;
before(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post("/login", loginByIpLimiter, loginByAccountLimiter, (req, res) => {
    if (req.body.password !== "correcta") return res.status(401).json({ error: "Credenciales inválidas" });
    resetAccountLoginLimit(req);
    res.json({ ok: true });
  });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(email, password, ip) {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

test("un cliente que entra bien nunca se traba", async () => {
  for (let i = 0; i < 25; i++) assert.equal(await login("ana@example.com", "correcta", "10.0.0.1"), 200);
});

test("10 contraseñas mal traban esa cuenta; otra cuenta desde la misma conexión sigue entrando", async () => {
  for (let i = 0; i < 10; i++) assert.equal(await login("beto@example.com", "mal", "10.0.0.2"), 401);
  assert.equal(await login("beto@example.com", "correcta", "10.0.0.2"), 429);
  assert.equal(await login("BETO@example.com ", "correcta", "10.0.0.9"), 429, "el email se compara sin mayúsculas ni espacios");
  assert.equal(await login("carla@example.com", "correcta", "10.0.0.2"), 200);
});

test("entrar bien vuelve a cero el contador de la cuenta", async () => {
  for (let i = 0; i < 9; i++) await login("dani@example.com", "mal", "10.0.0.3");
  assert.equal(await login("dani@example.com", "correcta", "10.0.0.3"), 200);
  for (let i = 0; i < 9; i++) assert.equal(await login("dani@example.com", "mal", "10.0.0.3"), 401);
});

test("30 fallidos desde la misma conexión, con cuentas distintas, traban esa conexión", async () => {
  for (let i = 0; i < 30; i++) assert.equal(await login(`prueba${i}@example.com`, "mal", "10.0.0.4"), 401);
  assert.equal(await login("otra@example.com", "mal", "10.0.0.4"), 429);
  assert.equal(await login("otra@example.com", "mal", "10.0.0.5"), 401, "otra conexión no se ve afectada");
});

test("con una IP de Cloudflare (Caddy sin la IP real) no se aplica el límite por IP", async () => {
  assert.ok(isCloudflareIp("173.245.48.10"));
  for (let i = 0; i < 35; i++) assert.equal(await login(`cf${i}@example.com`, "mal", "173.245.48.10"), 401);
});

test("isCloudflareIp reconoce IPv4, IPv6 y no confunde IPs comunes", () => {
  assert.ok(isCloudflareIp("104.16.1.1"));
  assert.ok(isCloudflareIp("::ffff:162.158.10.20"));
  assert.ok(isCloudflareIp("2606:4700::1"));
  assert.equal(isCloudflareIp("181.45.10.20"), false);
  assert.equal(isCloudflareIp("10.0.0.1"), false);
  assert.equal(isCloudflareIp(undefined), false);
});
