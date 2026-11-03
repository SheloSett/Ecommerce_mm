// Tests del "Ordenar por" de los productos de un pedido (orderItemSort.js). Correr con: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sortOrderItems, itemSupplier, itemSku } from "./orderItemSort.js";

const sup = (name) => ({ id: name.length, name });
const items = [
  { id: 1, price: 500,  currency: "ARS", product: { name: "Pendrive",  supplier: sup("zombie") } },
  { id: 2, price: 9000, currency: "ARS", product: { name: "Cargador",  supplier: sup("emax") } },
  { id: 3, price: 20,   currency: "USD", product: { name: "Consola",   supplier: null } },
  { id: 4, price: 1500, currency: "ARS", product: { name: "Auricular", supplier: sup("emax") } },
];
const ids = (list) => list.map((i) => i.id);

describe("itemSku", () => {
  test("manda el SKU guardado al venderse, después el de la variante y después el del producto", () => {
    const product = { sku: "PROD" };
    assert.equal(itemSku({ variantSku: "VENDIDO", variant: { sku: "VAR" }, product }), "VENDIDO");
    assert.equal(itemSku({ variantSku: null, variant: { sku: "VAR" }, product }), "VAR");
    assert.equal(itemSku({ product }), "PROD");
  });

  test("una variante con SKU vacío usa el del producto", () => {
    assert.equal(itemSku({ variantSku: "", variant: { sku: "" }, product: { sku: "PROD" } }), "PROD");
  });

  test("sin SKU en ningún lado (ítem libre o producto borrado): null, para no mostrar la línea", () => {
    assert.equal(itemSku({ product: { sku: null } }), null);
    assert.equal(itemSku({ productName: "Borrado", product: { id: null, name: "Borrado" } }), null);
    assert.equal(itemSku({}), null);
  });
});

describe("sortOrderItems", () => {
  test("como se cargó: igual que vino, y no toca el original", () => {
    assert.deepEqual(ids(sortOrderItems(items, "carga")), [1, 2, 3, 4]);
    sortOrderItems(items, "nombre");
    assert.deepEqual(ids(items), [1, 2, 3, 4]);
  });

  test("proveedor: alfabético, mismo proveedor juntos (por nombre), sin proveedor al final", () => {
    assert.deepEqual(ids(sortOrderItems(items, "proveedor")), [4, 2, 1, 3]);
  });

  test("el proveedor elegido en el pedido le gana al del producto", () => {
    const conCambio = items.map((i) => (i.id === 1 ? { ...i, supplier: sup("aaa") } : i));
    assert.equal(sortOrderItems(conCambio, "proveedor")[0].id, 1);
    assert.equal(itemSupplier(conCambio[0]).name, "aaa");
  });

  test("precio: dólares primero y cada moneda en la dirección elegida", () => {
    assert.deepEqual(ids(sortOrderItems(items, "precioDesc")), [3, 2, 4, 1]);
    assert.deepEqual(ids(sortOrderItems(items, "precioAsc")), [3, 1, 4, 2]);
  });

  test("nombre", () => {
    assert.deepEqual(ids(sortOrderItems(items, "nombre")), [4, 2, 3, 1]);
  });

  test("con funciones propias (filas del modo edición)", () => {
    const rows = [{ k: "a", p: "100", s: "" }, { k: "b", p: "50", s: "emax" }];
    const r = sortOrderItems(rows, "proveedor", { supplierName: (x) => x.s, price: (x) => Number(x.p) });
    assert.deepEqual(r.map((x) => x.k), ["b", "a"]);
  });
});
