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

// cloudinaryBanner: los flyers del carrusel del inicio (23/11/2026, se veían pixelados)
import { cloudinaryBanner } from "./imageUrl.js";

const slideGuardado = "https://res.cloudinary.com/demo/image/upload/c_limit,f_webp,h_600,q_auto,w_1920/v1792779829/ecommerce/slides/abc.webp";

test("banner: desde el original, solo tope de ancho y la mejor calidad automática", () => {
  assert.equal(cloudinaryBanner(slideGuardado, 1920),
    "https://res.cloudinary.com/demo/image/upload/c_limit,w_1920,q_auto:best,f_auto/v1792779829/ecommerce/slides/abc.webp");
  assert.equal(cloudinaryBanner(slideGuardado, 3840),
    "https://res.cloudinary.com/demo/image/upload/c_limit,w_3840,q_auto:best,f_auto/v1792779829/ecommerce/slides/abc.webp");
});

test("banner: un slide viejo guardado en el servidor (no Cloudinary) queda igual", () => {
  assert.equal(cloudinaryBanner("https://igwtstore.com.ar/uploads/slide.jpg", 1920), "https://igwtstore.com.ar/uploads/slide.jpg");
  assert.equal(cloudinaryBanner(null, 1920), null);
});
