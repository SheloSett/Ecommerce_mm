import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { productsApi, getImageUrl } from "../../services/api";
import * as XLSX from "xlsx";

const formatPrice = (v) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v ?? 0);

export default function AdminFlyer() {
  const [products, setProducts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(new Set());
  const [search, setSearch]       = useState("");
  const [showModal, setShowModal] = useState(false);
  const [priceType, setPriceType] = useState("MINORISTA"); // MINORISTA | MAYORISTA
  // "pdf" | "excel" — indica qué acción confirmar al cerrar el modal de precio
  const [pendingAction, setPendingAction] = useState("pdf");

  useEffect(() => {
    // getAllAdmin en vez de getAll para incluir atributos en el Excel
    productsApi
      .getAllAdmin({ limit: 200 })
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

  const handleExcelExport = () => {
    const selectedProducts = products.filter((p) => selected.has(p.id));
    const isMayorista = priceType === "MAYORISTA";
    const fmtPrice = (v) =>
      v != null
        ? "$ " + new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
        : "";

    // Nombre del atributo en MAYÚSCULAS para que resalte; separados por " | "
    const fmtAttrs = (p) =>
      (p.attributes || [])
        .map((a) => `${a.name.toUpperCase()}: ${(a.values || []).map((v) => v.value).join(" / ")}`)
        .join("  |  ");

    const rows = selectedProducts.map((p) => {
      const price = isMayorista
        ? (p.wholesaleSalePrice && p.wholesaleSalePrice < p.wholesalePrice ? p.wholesaleSalePrice : p.wholesalePrice) ?? p.price
        : (p.salePrice && p.salePrice < p.price ? p.salePrice : p.price);
      return {
        Foto:       p.images?.[0] ? getImageUrl(p.images[0]) : "",
        Título:     p.name,
        SKU:        p.sku || "",
        Precio:     fmtPrice(price),
        Atributos:  fmtAttrs(p),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    selectedProducts.forEach((p, i) => {
      const url = p.images?.[0] ? getImageUrl(p.images[0]) : null;
      if (!url) return;
      const cellRef = `A${i + 2}`;
      ws[cellRef] = { v: url, t: "s", l: { Target: url, Tooltip: "Ver imagen" } };
    });

    ws["!cols"] = [{ wch: 65 }, { wch: 40 }, { wch: 20 }, { wch: 18 }, { wch: 50 }];

    // wrapText en columna E (Atributos) para que cada atributo se vea en su propia línea
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 4 })];
      if (cell) cell.s = { alignment: { wrapText: true, vertical: "top" } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `flyer_${priceType.toLowerCase()}_${fecha}.xlsx`, { cellStyles: true });

    setShowModal(false);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  return (
    <AdminLayout title="Generar Flyer o Excel">
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
              onClick={() => { setPendingAction("pdf"); setShowModal(true); }}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              🖨 Generar PDF ({selected.size} producto{selected.size !== 1 ? "s" : ""})
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => { setPendingAction("excel"); setShowModal(true); }}
              className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
            >
              📥 Exportar Excel
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
                onClick={pendingAction === "excel" ? handleExcelExport : generatePDF}
                className={`flex-1 py-2.5 text-white rounded-xl text-sm font-semibold ${
                  pendingAction === "excel"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {pendingAction === "excel" ? "📥 Exportar Excel" : "🖨 Generar PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
