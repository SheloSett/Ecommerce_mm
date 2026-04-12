import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { productsApi, getImageUrl } from "../../services/api";

const formatPrice = (v) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v ?? 0);

export default function AdminFlyer() {
  const [products, setProducts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(new Set());
  const [search, setSearch]       = useState("");
  const [showModal, setShowModal] = useState(false);
  const [priceType, setPriceType] = useState("MINORISTA"); // MINORISTA | MAYORISTA

  useEffect(() => {
    productsApi
      .getAll({ limit: 200 })
      .then((res) => setProducts(res.data.products || res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  const getPrice = (product) => {
    if (priceType === "MAYORISTA") {
      return product.wholesaleSalePrice || product.wholesalePrice || product.salePrice || product.price;
    }
    return product.salePrice || product.price;
  };

  const generatePDF = () => {
    const selectedProducts = products.filter((p) => selected.has(p.id));

    const origin = window.location.origin;

    const rows = selectedProducts.map((p) => {
      const price = getPrice(p);
      const imgUrl = p.images?.[0] ? getImageUrl(p.images[0]) : null;
      const productUrl = `${origin}/producto/${p.id}`;
      return `
        <a class="product-card" href="${productUrl}" target="_blank">
          <div class="product-img">
            ${imgUrl
              ? `<img src="${imgUrl}" alt="${p.name}" crossorigin="anonymous" />`
              : `<div class="no-img">📦</div>`
            }
          </div>
          <div class="product-info">
            <p class="product-name">${p.name}</p>
            ${p.sku ? `<p class="product-sku">SKU: ${p.sku}</p>` : ""}
            <p class="product-price">${formatPrice(price)}</p>
            ${priceType === "MAYORISTA"
              ? `<span class="badge badge-mayorista">Precio mayorista</span>`
              : `<span class="badge badge-minorista">Precio minorista</span>`
            }
            <p class="product-promo">ver más promociones en la web</p>
          </div>
        </a>
      `;
    }).join("");

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Flyer de productos — IGWT Store</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #f8fafc;
            color: #1e293b;
            padding: 24px;
          }
          .header {
            text-align: center;
            margin-bottom: 28px;
            padding-bottom: 20px;
            border-bottom: 3px solid #0f172a;
          }
          .store-link {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            margin-bottom: 8px;
          }
          .store-icon {
            width: 36px;
            height: 36px;
            background: #0f172a;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          }
          .store-name {
            font-size: 26px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -1px;
          }
          .store-name span {
            color: #f59e0b;
          }
          .header-sub {
            font-size: 13px;
            color: #64748b;
            margin-top: 6px;
          }
          .header-url {
            font-size: 11px;
            color: #94a3b8;
            margin-top: 3px;
            text-decoration: none;
          }
          .header-url:hover { color: #64748b; }
          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
          }
          .product-card {
            background: #fff;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            break-inside: avoid;
            text-decoration: none;
            color: inherit;
            display: block;
            transition: box-shadow 0.15s;
          }
          .product-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.10); }
          .product-img {
            width: 100%;
            aspect-ratio: 1;
            background: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .product-img img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .no-img {
            font-size: 48px;
            opacity: 0.3;
          }
          .product-info {
            padding: 12px;
          }
          .product-name {
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
            margin-bottom: 2px;
            line-height: 1.3;
          }
          .product-sku {
            font-size: 10px;
            color: #94a3b8;
            margin-bottom: 6px;
          }
          .product-price {
            font-size: 20px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 6px;
          }
          .badge {
            display: inline-block;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .badge-mayorista { background: #dcfce7; color: #166534; }
          .badge-minorista { background: #dbeafe; color: #1e40af; }
          .product-promo {
            font-size: 10px;
            color: #3b82f6;
            margin-top: 6px;
            font-style: italic;
          }
          .footer {
            margin-top: 28px;
            padding-top: 12px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            font-size: 11px;
            color: #94a3b8;
          }
          .print-btn {
            display: block;
            margin: 0 auto 24px;
            padding: 10px 28px;
            background: #0f172a;
            color: #fff;
            font-size: 14px;
            font-weight: 700;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            letter-spacing: 0.3px;
          }
          .print-btn:hover { background: #1e293b; }
          @media print {
            .print-btn { display: none !important; }
            body { background: #fff; padding: 16px; }
            @page { margin: 1cm; }
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
        <div class="header">
          <a class="store-link" href="${origin}" target="_blank">
            <div class="store-icon">⚡</div>
            <span class="store-name">IGWT <span>Store</span></span>
          </a>
          <p class="header-sub">${priceType === "MAYORISTA" ? "Precios mayoristas" : "Precios minoristas"} · ${selectedProducts.length} producto${selectedProducts.length !== 1 ? "s" : ""}</p>
          <a class="header-url" href="${origin}" target="_blank">${origin}</a>
        </div>
        <div class="grid">${rows}</div>
        <div class="footer">Generado el ${new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}</div>
        <script>
          // Forzar todos los links a abrirse en nueva pestaña sin cerrar el flyer
          document.querySelectorAll('a').forEach(function(a) {
            a.addEventListener('click', function(e) {
              e.preventDefault();
              window.open(a.href, '_blank', 'noopener,noreferrer');
            });
          });
        <\/script>
      </body>
      </html>
    `;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    setShowModal(false);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  return (
    <AdminLayout title="Generar flyer">
      <div className="space-y-4">

        {/* Barra superior */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {selected.size > 0 && (
            <button
              onClick={() => setShowModal(true)}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              🖨 Generar PDF ({selected.size} producto{selected.size !== 1 ? "s" : ""})
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-right">P. Minorista</th>
                  <th className="px-4 py-3 text-right">P. Mayorista</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No se encontraron productos
                    </td>
                  </tr>
                ) : (
                  filtered.map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        selected.has(p.id)
                          ? "bg-blue-50"
                          : i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                            {p.images?.[0]
                              ? <img src={getImageUrl(p.images[0])} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-lg">📦</div>
                            }
                          </div>
                          <span className="font-medium text-slate-800">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">
                        {formatPrice(p.salePrice || p.price)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">
                        {p.wholesalePrice ? formatPrice(p.wholesaleSalePrice || p.wholesalePrice) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{p.sku || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: elegir tipo de precio */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-1">¿Qué precio mostrar?</h2>
            <p className="text-sm text-slate-500 mb-5">
              Se aplicará a los {selected.size} productos seleccionados
            </p>
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setPriceType("MINORISTA")}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  priceType === "MINORISTA"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                💳 Minorista
              </button>
              <button
                onClick={() => setPriceType("MAYORISTA")}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  priceType === "MAYORISTA"
                    ? "border-green-500 bg-green-50 text-green-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                🏢 Mayorista
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={generatePDF}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"
              >
                Generar PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
