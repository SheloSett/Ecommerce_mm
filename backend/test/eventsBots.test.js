// Tests de que los robots no cuentan como visitantes (utils/botDetect.js y controllers/events.controller.js):
// ni se guardan sus vistas ni aparecen en "En vivo". Base simulada. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

let saved, contacts;
class FakePrismaClient {
  constructor() {
    this.storeEvent = { create: async ({ data }) => { saved.push(data); return data; } };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/meta.service.js"), {
  browserDataFromRequest: () => null,
  isContactEventId: () => true,
  sendContactEvent: async (e) => { contacts.push(e); },
});

const { isBot } = require("../src/utils/botDetect");
const { track, ping, contact, livePresence } = require("../src/controllers/events.controller");

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 338.0.0.0 (iPhone14,5; iOS 17_5; es_AR; es; scale=3.00; 1170x2532)",
  facebookApp: "Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]",
  tiktokApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/es Region/AR BytedanceWebview/d8a21c6",
  cubot: "Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 21) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  googlebotMovil: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotPc: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126.0.0.0 Safari/537.36",
  adsbot: "AdsBot-Google (+http://www.google.com/adsbot.html)",
  bing: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  meta: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  tiktok: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  ahrefs: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
  lighthouse: "Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  curl: "curl/8.5.0",
  python: "python-requests/2.32.3",
};
const PERSONAS = ["iphone", "android", "windows", "instagram", "facebookApp", "tiktokApp", "cubot"];
const ROBOTS = ["googlebotMovil", "googlebotPc", "adsbot", "bing", "facebook", "meta", "tiktok", "ahrefs", "headless", "lighthouse", "curl", "python"];

const fakeRes = () => ({ code: 200, body: undefined, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const sid = (n) => `sesion${String(n).padStart(4, "0")}`;
const call = async (handler, ua, body) => { const res = fakeRes(); await handler({ headers: { "user-agent": ua }, body }, res); return res; };

describe("isBot", () => {
  test("los navegadores de la gente, también dentro de Instagram, Facebook y TikTok, no son robots", () => {
    for (const k of PERSONAS) assert.equal(isBot(UA[k]), false, k);
  });

  test("buscadores, verificadores de anuncios, herramientas y programas sí", () => {
    for (const k of ROBOTS) assert.equal(isBot(UA[k]), true, k);
  });

  test("sin navegador declarado también", () => {
    for (const ua of ["", undefined, null, "x"]) assert.equal(isBot(ua), true);
  });
});

describe("los robots no cuentan como visitantes", () => {
  beforeEach(() => { saved = []; contacts = []; });

  test("la vista de una persona se guarda, con su dispositivo", async () => {
    const res = await call(track, UA.iphone, { type: "PAGE_VIEW", sessionId: sid(1), path: "/catalogo" });
    assert.equal(res.code, 201);
    assert.deepEqual(saved.map((e) => [e.type, e.path, e.device]), [["PAGE_VIEW", "/catalogo", "celular"]]);
  });

  test("la de un robot no se guarda, y no es un error", async () => {
    for (const k of ROBOTS) {
      const res = await call(track, UA[k], { type: "PAGE_VIEW", sessionId: sid(2), path: "/login?volver=%2Fproducto%2Fcable" });
      assert.equal(res.code, 204, k);
    }
    assert.equal(saved.length, 0);
  });

  test("un robot no aparece en 'En vivo'; una persona sí", async () => {
    await call(ping, UA.googlebotMovil, { sessionId: sid(3), path: "/producto/cable" });
    assert.equal(livePresence().some((p) => p.sessionId === sid(3)), false);
    await call(ping, UA.android, { sessionId: sid(4), path: "/producto/cable" });
    assert.equal(livePresence().some((p) => p.sessionId === sid(4)), true);
  });

  test("el clic en WhatsApp de un robot no se le manda a Meta", async () => {
    const robot = await call(contact, UA.headless, { eventId: "wa-1", path: "/" });
    assert.equal(robot.code, 202);
    assert.equal(contacts.length, 0);
    await call(contact, UA.iphone, { eventId: "wa-2", path: "/" });
    assert.equal(contacts.length, 1);
  });
});
