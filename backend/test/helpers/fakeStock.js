// Lo que services/stock.service.js le pide a la base, para sumárselo a la base simulada de cada test.
//
// Cada archivo de test arma su propio FakePrismaClient con lo justo para lo que prueba. El servicio de
// stock necesita tres cosas que no todos tienen:
//   - $transaction(fn): cada ajuste corre dentro de una transacción. Acá fn corre con el mismo cliente
//     (en los tests no hay concurrencia real; la de Postgres se prueba aparte, contra una base de verdad).
//   - stockMovement: el historial. Se guarda en la lista que devuelve movements(), así el test puede
//     mirar qué quedó anotado.
//   - product.findUnique con include.variants: syncProductVisibility mira las variantes activas para
//     decidir si el producto se publica. variantsOf(productId) devuelve las variantes de la base simulada.
//
// Uso, al final del constructor del FakePrismaClient del test:
//   withStockSupport(this, { movements: () => db.movements, variantsOf: (pid) => Object.values(db.variants)... });
// (con funciones, porque los tests vuelven a armar `db` en cada beforeEach).

function withStockSupport(client, { movements = () => [], variantsOf = () => [] } = {}) {
  if (typeof client.$transaction !== "function") {
    client.$transaction = async (arg) => (typeof arg === "function" ? arg(client) : Promise.all(arg));
  }

  if (!client.stockMovement) {
    client.stockMovement = {
      create: async ({ data }) => {
        const list = movements();
        const row = { id: list.length + 1, createdAt: new Date(), ...JSON.parse(JSON.stringify(data)) };
        list.push(row);
        return { ...row };
      },
      findMany: async ({ where = {}, take } = {}) => {
        const rows = movements()
          .filter((m) => where.productId === undefined || m.productId === where.productId)
          .slice()
          .reverse();
        return take ? rows.slice(0, take) : rows;
      },
    };
  }

  if (client.product?.findUnique) {
    const original = client.product.findUnique.bind(client.product);
    client.product.findUnique = async (args) => {
      const row = await original(args);
      if (row && args?.include?.variants && !Array.isArray(row.variants)) {
        row.variants = (variantsOf(row.id) || [])
          .filter((v) => v.active !== false)
          .map((v) => ({ stock: v.stock, stockUnlimited: !!v.stockUnlimited }));
      }
      return row;
    };
  }

  return client;
}

module.exports = { withStockSupport };
