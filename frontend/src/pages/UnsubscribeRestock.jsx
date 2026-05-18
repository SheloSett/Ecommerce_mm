import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import api from "../services/api";

export default function UnsubscribeRestock() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading"); // "loading" | "success" | "error"

  useEffect(() => {
    const token = searchParams.get("token");
    const id = searchParams.get("id");

    if (!token || !id) {
      setStatus("error");
      return;
    }

    api.get(`/customers/unsubscribe/restock?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`)
      .then(() => setStatus("success"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-slate-800 rounded-2xl p-10 max-w-md w-full text-center shadow-xl border border-slate-700">
        {status === "loading" && (
          <>
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <p className="text-slate-300 text-lg">Procesando...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">Listo</h1>
            <p className="text-slate-300 text-base leading-relaxed mb-6">
              Ya no vas a recibir recordatorios de restock.
            </p>
            <Link to="/" className="text-green-400 hover:text-green-300 text-sm underline">
              Volver al inicio
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">Link inválido</h1>
            <p className="text-slate-300 text-base leading-relaxed mb-6">
              El link no es válido o ya fue procesado anteriormente.
            </p>
            <Link to="/" className="text-green-400 hover:text-green-300 text-sm underline">
              Volver al inicio
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
