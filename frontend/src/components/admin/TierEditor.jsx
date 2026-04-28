export default function TierEditor({ label, tiers, fieldKey, setForm }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-slate-700">
          {label}
          <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
        </label>
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, [fieldKey]: [...f[fieldKey], { minQty: "", price: "" }] }))}
          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
        >
          + Agregar nivel
        </button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Sin descuentos por cantidad configurados.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-2 text-left font-semibold">Desde (unidades)</th>
                <th className="px-3 py-2 text-left font-semibold">Precio unitario</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs">+</span>
                      <input
                        type="number"
                        min="1"
                        value={tier.minQty}
                        onChange={(e) =>
                          setForm((f) => {
                            const updated = [...f[fieldKey]];
                            updated[idx] = { ...updated[idx], minQty: e.target.value };
                            return { ...f, [fieldKey]: updated };
                          })
                        }
                        placeholder="ej: 10"
                        className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <span className="text-xs text-slate-400">unid.</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={tier.price}
                        onChange={(e) =>
                          setForm((f) => {
                            const updated = [...f[fieldKey]];
                            updated[idx] = { ...updated[idx], price: e.target.value };
                            return { ...f, [fieldKey]: updated };
                          })
                        }
                        placeholder="0.00"
                        className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, [fieldKey]: f[fieldKey].filter((_, i) => i !== idx) }))
                      }
                      className="text-red-400 hover:text-red-600 text-base leading-none"
                      title="Eliminar nivel"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-1">
        Se aplica el precio del mayor nivel que no supere la cantidad pedida.
      </p>
    </div>
  );
}
