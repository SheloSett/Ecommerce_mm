// Carrito de quien todavía no inició sesión. Vive en el navegador y guarda solo lo mínimo: qué producto, qué
// variante, cuántos y a qué precio lo agregó. El nombre, la foto, el precio de hoy y si sigue disponible los
// pone el servidor (POST /api/carts/guest), igual que con el carrito de una cuenta.
//
// Antes, sin cuenta no se podía agregar nada: el botón mandaba a iniciar sesión y el que venía a comprar
// se encontraba con un formulario de registro. Al iniciar sesión, este carrito pasa al de la cuenta
// (ver CartContext).
import { storageGetJSON, storageSet, storageRemove } from "./storage.js";

const KEY = "igwt_cart_guest";
// Los mismos topes que el servidor (backend routes/cart.routes.js: GUEST_MAX_LINES y GUEST_MAX_QUANTITY)
export const GUEST_CART_MAX_LINES = 60;
const MAX_QUANTITY = 9999;

// Identifica una línea: mismo producto y misma variante. Es el id que usa el carrito para cambiar la
// cantidad o sacarla (el servidor arma el mismo).
export const guestKey = (productId, variantId) => `g-${productId}-${variantId || 0}`;
const isLine = (line, key) => guestKey(line.productId, line.variantId) === key;

function toLine(raw) {
  const productId = parseInt(raw?.productId);
  const variantId = raw?.variantId ? parseInt(raw.variantId) : null;
  const quantity = parseInt(raw?.quantity);
  const price = Number(raw?.price);
  if (!(productId > 0) || !(quantity > 0) || (variantId !== null && !(variantId > 0))) return null;
  return { productId, variantId, quantity: Math.min(quantity, MAX_QUANTITY), price: Number.isFinite(price) && price > 0 ? price : null };
}

// Lista válida: sin basura, sin líneas repetidas (se suman) y con tope.
export function cleanGuestCart(list) {
  const lines = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const line = toLine(raw);
    if (!line) continue;
    const key = guestKey(line.productId, line.variantId);
    const prev = lines.get(key);
    if (prev) prev.quantity = Math.min(prev.quantity + line.quantity, MAX_QUANTITY);
    else if (lines.size < GUEST_CART_MAX_LINES) lines.set(key, line);
  }
  return [...lines.values()];
}

export function readGuestCart() {
  return cleanGuestCart(storageGetJSON(KEY, Array.isArray));
}

export function writeGuestCart(lines) {
  const clean = cleanGuestCart(lines);
  if (clean.length) storageSet(KEY, JSON.stringify(clean));
  else storageRemove(KEY);
}

// "price" es el precio al agregar: contra ese se avisa si después cambia (terminó una campaña, por ejemplo).
// Lo pone siempre el servidor (setGuestPrice). Al agregar o cambiar la cantidad, la línea tocada queda sin
// precio hasta que el servidor responda: si se guardara el que calcula la tienda, un producto con precio por
// cantidad avisaría "cambió de precio" solo por pasar de un tramo a otro.

// Agregar: si ya estaba, suma la cantidad.
export function addGuestLine(lines, line) {
  const added = toLine({ ...line, price: null });
  if (!added) return cleanGuestCart(lines);
  const key = guestKey(added.productId, added.variantId);
  let found = false;
  const next = cleanGuestCart(lines).map((l) => {
    if (!isLine(l, key)) return l;
    found = true;
    return { ...l, quantity: Math.min(l.quantity + added.quantity, MAX_QUANTITY), price: null };
  });
  return found ? next : cleanGuestCart([...next, added]);
}

// Cambiar la cantidad de una línea; con 0 o menos, se saca.
export function setGuestQuantity(lines, key, quantity) {
  const qty = parseInt(quantity);
  return cleanGuestCart(lines).flatMap((l) => {
    if (!isLine(l, key)) return [l];
    return qty > 0 ? [{ ...l, quantity: Math.min(qty, MAX_QUANTITY), price: null }] : [];
  });
}

export function removeGuestLine(lines, key) {
  return cleanGuestCart(lines).filter((l) => !isLine(l, key));
}

// El precio que respondió el servidor para esa línea queda como "precio al agregar".
export function setGuestPrice(lines, key, price) {
  const value = Number(price);
  return cleanGuestCart(lines).map((l) => (isLine(l, key) ? { ...l, price: Number.isFinite(value) && value > 0 ? value : null } : l));
}

// Deja una línea como estaba antes de un cambio que no se pudo confirmar. previous: la línea anterior, o
// nada si no existía (entonces se saca).
export function restoreGuestLine(lines, key, previous) {
  const rest = cleanGuestCart(lines).filter((l) => !isLine(l, key));
  return previous ? cleanGuestCart([...rest, previous]) : rest;
}
