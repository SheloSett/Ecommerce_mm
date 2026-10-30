// Tests de cloudinarySized (utils/imageUrl.js), la que usa getImageUrl para pedir fotos achicadas.
// Correr con: npm test (en frontend)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudinarySized } from "./imageUrl.js";

const stored = "https://res.cloudinary.com/demo/image/upload/c_pad,b_white,f_webp,h_1200,q_auto,w_1200/v1712345678/ecommerce/abc123.webp";

test("pide el tamaño indicado, reemplazando la transformación guardada", () => {
  assert.equal(cloudinarySized(stored, 400),
    "https://res.cloudinary.com/demo/image/upload/c_pad,b_white,w_400,h_400,q_auto,f_auto/v1712345678/ecommerce/abc123.webp");
});

test("una URL de Cloudinary sin transformación también se achica", () => {
  assert.equal(cloudinarySized("https://res.cloudinary.com/demo/image/upload/v1/ecommerce/x.jpg", 128),
    "https://res.cloudinary.com/demo/image/upload/c_pad,b_white,w_128,h_128,q_auto,f_auto/v1/ecommerce/x.jpg");
});

test("sin tamaño, o si no es de Cloudinary, queda igual", () => {
  assert.equal(cloudinarySized(stored), stored);
  assert.equal(cloudinarySized("https://otro.com/foto.jpg", 400), "https://otro.com/foto.jpg");
  assert.equal(cloudinarySized(null, 400), null);
});
