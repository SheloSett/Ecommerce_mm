import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { customersApi, mayoristaRequestsApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
import toast from "react-hot-toast";

export default function EditProfile() {
  const { customer, customerLogout, updateCustomerData, updateCustomerWithToken } = useCustomerAuth();
  const navigate = useNavigate();

  // Redirigir si no hay sesión
  if (!customer) {
    navigate("/login");
    return null;
  }

  // ─── Estado formulario datos generales ───────────────────────────────────────
  const [name, setName]   = useState(customer.name || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // ─── Estado cambio de email ───────────────────────────────────────────────────
  const [emailSection, setEmailSection] = useState(false);
  const [newEmail, setNewEmail]         = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [savingEmail, setSavingEmail]   = useState(false);

  // ─── Estado solicitud mayorista ──────────────────────────────────────────────
  const [mayoristaRequest, setMayoristaRequest]       = useState(null); // solicitud actual
  const [mayoristaMessage, setMayoristaMessage]       = useState("");
  const [sendingRequest, setSendingRequest]           = useState(false);
  const [mayoristaFormOpen, setMayoristaFormOpen]     = useState(false);

  // Cargar la solicitud existente al montar (si es MINORISTA)
  useEffect(() => {
    if (customer.type !== "MINORISTA") return;
    mayoristaRequestsApi.getMy()
      .then((res) => setMayoristaRequest(res.data))
      .catch(() => {}); // silencioso si falla
  }, [customer.type]);

  const handleSendMayoristaRequest = async (e) => {
    e.preventDefault();
    setSendingRequest(true);
    try {
      const res = await mayoristaRequestsApi.create({ message: mayoristaMessage.trim() || undefined });
      setMayoristaRequest(res.data);
      setMayoristaFormOpen(false);
      setMayoristaMessage("");
      toast.success("Solicitud enviada. El administrador la revisará pronto.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar la solicitud");
    } finally {
      setSendingRequest(false);
    }
  };

  // ─── Estado avatar ────────────────────────────────────────────────────────────
  const [avatarPreview, setAvatarPreview] = useState(
    customer.avatar ? getImageUrl(customer.avatar) : null
  );
  const [avatarFile, setAvatarFile] = useState(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef(null);

  // ─── Guardar nombre y teléfono ────────────────────────────────────────────────
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await customersApi.updateMe({ name: name.trim(), phone });
      updateCustomerData({ name: res.data.name, phone: res.data.phone });
      toast.success("Perfil actualizado");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar el perfil");
    } finally {
      setSavingProfile(false);
    }
  };

  // ─── Cambiar email ────────────────────────────────────────────────────────────
  const handleChangeEmail = async (e) => {
    e.preventDefault();
    if (!newEmail.trim() || !emailPassword) {
      toast.error("Completá todos los campos");
      return;
    }
    setSavingEmail(true);
    try {
      const res = await customersApi.changeEmail({ newEmail: newEmail.trim(), password: emailPassword });
      updateCustomerWithToken(res.data.token, { email: res.data.customer.email });
      toast.success("Email actualizado correctamente");
      setEmailSection(false);
      setNewEmail("");
      setEmailPassword("");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al cambiar el email");
    } finally {
      setSavingEmail(false);
    }
  };

  // ─── Seleccionar imagen de perfil ─────────────────────────────────────────────
  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // ─── Subir avatar ─────────────────────────────────────────────────────────────
  const handleUploadAvatar = async () => {
    if (!avatarFile) return;
    setSavingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("avatar", avatarFile);
      const res = await customersApi.uploadAvatar(formData);
      updateCustomerData({ avatar: res.data.avatar });
      setAvatarFile(null);
      toast.success("Foto de perfil actualizada");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al subir la imagen");
    } finally {
      setSavingAvatar(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-slate-50 py-10 px-4">
        <div className="max-w-xl mx-auto space-y-6">

          {/* Cabecera */}
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => navigate(-1)}
              className="text-slate-500 hover:text-slate-800 transition-colors"
              aria-label="Volver"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-slate-800">Editar perfil</h1>
          </div>

          {/* ── Foto de perfil ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Foto de perfil</h2>
            <div className="flex items-center gap-5">
              {/* Avatar actual o placeholder */}
              <div
                className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden cursor-pointer border-2 border-slate-300 hover:border-blue-400 transition-colors flex-shrink-0"
                onClick={() => fileInputRef.current?.click()}
                title="Cambiar foto"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Elegir imagen
                </button>
                {avatarFile && (
                  <button
                    onClick={handleUploadAvatar}
                    disabled={savingAvatar}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {savingAvatar ? "Subiendo..." : "Guardar foto"}
                  </button>
                )}
                <p className="text-xs text-slate-400">JPG, PNG, WEBP o GIF · máx. 5 MB</p>
              </div>
            </div>
          </div>

          {/* ── Datos personales ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Datos personales</h2>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="Tu nombre"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="+54 11 1234-5678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de cuenta</label>
                <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                  customer.type === "MAYORISTA"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}>
                  {customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                </div>
              </div>
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {savingProfile ? "Guardando..." : "Guardar cambios"}
              </button>
            </form>
          </div>

          {/* ── Solicitud para pasar a Mayorista (solo para MINORISTA) ── */}
          {customer.type === "MINORISTA" && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Cuenta Mayorista</h2>

              {/*
                canApply = puede enviar una nueva solicitud.
                Se cumple cuando:
                - No hay ninguna solicitud previa, O
                - La solicitud anterior fue REJECTED (puede reintentar), O
                - La solicitud anterior fue APPROVED pero el cliente sigue siendo MINORISTA
                  (el admin lo degradó de vuelta, puede volver a solicitar)
              */}
              {(() => {
                const canApply = !mayoristaRequest
                  || mayoristaRequest.status === "REJECTED"
                  || (mayoristaRequest.status === "APPROVED" && customer.type === "MINORISTA");
                const hasPending = mayoristaRequest?.status === "PENDING";

                return (
                  <>
                    {/* Botón para solicitar (cuando puede aplicar y no tiene el form abierto) */}
                    {canApply && !mayoristaFormOpen && (
                      <div className="flex items-start gap-4">
                        <div className="flex-1">
                          <p className="text-sm text-slate-700 font-medium">¿Sos revendedor o comprás por mayor?</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Solicitá acceso a la cuenta Mayorista para ver precios y condiciones especiales.
                            El administrador revisará tu solicitud.
                          </p>
                        </div>
                        <button
                          onClick={() => setMayoristaFormOpen(true)}
                          className="flex-shrink-0 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
                        >
                          Solicitar
                        </button>
                      </div>
                    )}

                    {/* Estado PENDIENTE */}
                    {hasPending && !mayoristaFormOpen && (
                      <div className="flex items-center gap-3 p-3 rounded-xl text-sm bg-yellow-50 border border-yellow-200">
                        <span className="text-lg">⏳</span>
                        <div>
                          <p className="font-medium text-yellow-800">Solicitud pendiente de revisión</p>
                          <p className="text-xs text-slate-400 mt-0.5">El administrador revisará tu solicitud pronto.</p>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Formulario de solicitud */}
              {mayoristaFormOpen && (
                <form onSubmit={handleSendMayoristaRequest} className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Podés agregar un mensaje opcional explicando tu actividad o empresa.
                  </p>
                  <textarea
                    value={mayoristaMessage}
                    onChange={(e) => setMayoristaMessage(e.target.value)}
                    rows={3}
                    placeholder="Ej: Soy revendedor de electrónica, tengo local en Mendoza..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-purple-500 transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setMayoristaFormOpen(false); setMayoristaMessage(""); }}
                      className="flex-1 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={sendingRequest}
                      className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {sendingRequest ? "Enviando..." : "Enviar solicitud"}
                    </button>
                  </div>
                </form>
              )}

              {/* Estado APROBADO (solo cuando el token aún no refleja el cambio, es decir sigue como MINORISTA) */}
              {mayoristaRequest?.status === "APPROVED" && customer.type === "MINORISTA" && !mayoristaFormOpen && (
                <div className="flex items-center gap-3 p-3 rounded-xl text-sm bg-green-50 border border-green-200 mt-3">
                  <span className="text-lg">✅</span>
                  <div>
                    <p className="font-medium text-green-800">Solicitud aprobada anteriormente</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Tu cuenta fue modificada por el administrador. Podés volver a solicitar ser Mayorista arriba.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Cambio de email ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Email</h2>
              <button
                onClick={() => { setEmailSection((v) => !v); setNewEmail(""); setEmailPassword(""); }}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                {emailSection ? "Cancelar" : "Cambiar"}
              </button>
            </div>
            <p className="text-sm text-slate-700 mb-3">{customer.email}</p>

            {emailSection && (
              <form onSubmit={handleChangeEmail} className="space-y-3 pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  Para cambiar el email debés confirmar tu contraseña actual.
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nuevo email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="nuevo@email.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña actual</label>
                  <input
                    type="password"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingEmail}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savingEmail ? "Verificando..." : "Confirmar cambio de email"}
                </button>
              </form>
            )}
          </div>

          {/* ── Cerrar sesión ── */}
          <button
            onClick={() => { customerLogout(); navigate("/"); }}
            className="w-full py-2.5 border border-red-300 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Cerrar sesión
          </button>

        </div>
      </div>
    </>
  );
}
