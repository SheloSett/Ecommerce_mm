import { useState, /* useRef, */ useEffect } from "react"; // useRef eliminado: ya no se usa el file input de avatar
import { useNavigate } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { customersApi, mayoristaRequestsApi /*, getImageUrl */ } from "../services/api"; // getImageUrl eliminado: ya no se muestra avatar
import { useSiteConfig } from "../context/SiteConfigContext";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import toast from "react-hot-toast";

// SVG del logo de WhatsApp — reemplaza el ícono genérico de chat del template
function WhatsAppIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

export default function EditProfile() {
  const { customer, customerLogout, updateCustomerData } = useCustomerAuth();
  const { footerPhone } = useSiteConfig();
  const navigate = useNavigate();

  // Redirigir si no hay sesión
  if (!customer) {
    navigate("/login");
    return null;
  }

  // ─── Estado formulario datos generales ───────────────────────────────────────
  const [name, setName]               = useState(customer.name || "");
  const [phone, setPhone]             = useState(customer.phone || "");
  const [documentType, setDocumentType] = useState(customer.documentType || "DNI");
  const [cuit, setCuit]               = useState(customer.cuit || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // ─── Estado suscripción emails de restock (solo MAYORISTA) ───────────────────
  const [unsubscribeRestock, setUnsubscribeRestock] = useState(customer.unsubscribeRestock ?? false);
  const [savingRestock, setSavingRestock]           = useState(false);

  // ─── Estado solicitud cambio de email ────────────────────────────────────────
  const [emailSection, setEmailSection]     = useState(false);
  const [newEmail, setNewEmail]             = useState("");
  const [emailReason, setEmailReason]       = useState("");
  const [savingEmail, setSavingEmail]       = useState(false);
  const [emailRequest, setEmailRequest]     = useState(null);

  // ─── Estado cambio de contraseña ────────────────────────────────────────────
  const [pwdForm, setPwdForm]         = useState({ current: "", newPwd: "", confirm: "" });
  const [savingPwd, setSavingPwd]     = useState(false);
  const [pwdSection, setPwdSection]   = useState(false);

  // ─── Estado solicitud mayorista ──────────────────────────────────────────────
  const [mayoristaRequest, setMayoristaRequest]   = useState(null);
  const [mayoristaMessage, setMayoristaMessage]   = useState("");
  const [sendingRequest, setSendingRequest]       = useState(false);
  const [mayoristaFormOpen, setMayoristaFormOpen] = useState(false);

  // ─── Estado avatar — Eliminado: campo removido del schema para ahorrar espacio en BD ─
  // const [avatarPreview, setAvatarPreview] = useState(
  //   customer.avatar ? getImageUrl(customer.avatar) : null
  // );
  // const [avatarFile, setAvatarFile] = useState(null);
  // const [savingAvatar, setSavingAvatar] = useState(false);
  // const fileInputRef = useRef(null);

  // Cargar solicitud de cambio de email activa
  useEffect(() => {
    customersApi.getMyEmailChangeRequest()
      .then((res) => setEmailRequest(res.data))
      .catch(() => {});
  }, []);

  // Cargar la solicitud existente al montar (si es MINORISTA)
  useEffect(() => {
    if (customer.type !== "MINORISTA") return;
    mayoristaRequestsApi.getMy()
      .then((res) => setMayoristaRequest(res.data))
      .catch(() => {});
  }, [customer.type]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwdForm.newPwd.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres");
    if (pwdForm.newPwd !== pwdForm.confirm) return toast.error("Las contraseñas no coinciden");
    setSavingPwd(true);
    try {
      await customersApi.changePassword({ currentPassword: pwdForm.current, newPassword: pwdForm.newPwd });
      toast.success("Contraseña actualizada");
      setPwdForm({ current: "", newPwd: "", confirm: "" });
      setPwdSection(false);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al cambiar la contraseña");
    } finally {
      setSavingPwd(false);
    }
  };

  const handleToggleRestock = async () => {
    const newValue = !unsubscribeRestock;
    setSavingRestock(true);
    try {
      await customersApi.updateMe({ unsubscribeRestock: newValue });
      setUnsubscribeRestock(newValue);
      toast.success(newValue ? "Ya no vas a recibir recordatorios de restock" : "Recordatorios de restock activados");
    } catch {
      toast.error("Error al actualizar la preferencia");
    } finally {
      setSavingRestock(false);
    }
  };

  const handleSendResetLink = async () => {
    try {
      await customersApi.forgotPassword(customer.email);
      toast.success("Te enviamos un link a " + customer.email);
    } catch {
      toast.error("Error al enviar el link");
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("El nombre no puede estar vacío");
    setSavingProfile(true);
    try {
      const res = await customersApi.updateMe({ name: name.trim(), phone, cuit, documentType });
      updateCustomerData({ name: res.data.name, phone: res.data.phone, cuit: res.data.cuit, documentType: res.data.documentType });
      toast.success("Perfil actualizado");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar el perfil");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    if (!newEmail.trim() || !emailReason.trim()) return toast.error("Completá todos los campos");
    setSavingEmail(true);
    try {
      const res = await customersApi.requestEmailChange({ newEmail: newEmail.trim(), reason: emailReason.trim() });
      setEmailRequest(res.data);
      toast.success("Solicitud enviada. El administrador la revisará pronto.");
      setEmailSection(false);
      setNewEmail("");
      setEmailReason("");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar la solicitud");
    } finally {
      setSavingEmail(false);
    }
  };

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

  // ─── Seleccionar/subir imagen de perfil — Eliminado: avatar removido del schema ─
  // const handleAvatarChange = (e) => { ... };
  // const handleUploadAvatar = async () => { ... };

  // ─── URL de WhatsApp con mensaje pre-armado con datos del usuario ─────────────
  // Se usa footerPhone del SiteConfig (configurable desde el admin)
  // Formato WhatsApp Argentina: https://wa.me/549{numero}
  const whatsappUrl = (() => {
    const rawPhone = (footerPhone || "").replace(/\D/g, "");
    const intlPhone = rawPhone.startsWith("549") ? rawPhone : `549${rawPhone}`;
    const lines = [
      "¡Hola! Necesito ayuda con mi cuenta en IGWT Store.",
      "",
      "📋 *Mis datos:*",
      `• Nombre: ${customer.name}`,
      `• Email: ${customer.email}`,
      `• Tipo de cuenta: ${customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}`,
      cuit ? `• Documento: ${documentType} ${cuit}` : "",
      "",
      "❓ *Mi consulta:*",
      "[Escribí aquí tu consulta]",
    ].filter((l) => l !== null && l !== undefined && !(l === "" && false)).join("\n");
    return `https://wa.me/${intlPhone}?text=${encodeURIComponent(lines)}`;
  })();

  // Clases reutilizables del diseño Stitch traducidas a Tailwind estándar
  const inputCls = "w-full bg-slate-50 border border-[#bdcaba] rounded-lg px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all";
  const cardCls  = "bg-white rounded-xl border border-[#bdcaba]/60 p-8 shadow-sm";

  return (
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title="Editar perfil | IGWT Store" />
      <Navbar />

      <main className="flex-grow max-w-[1280px] mx-auto w-full px-6 py-14">

        {/* ── Cabecera ── */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-slate-100 transition-all text-slate-600"
            aria-label="Volver"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
            Editar perfil
          </h1>
        </div>

        {/* ── Grid principal: 8/12 izquierda + 4/12 derecha ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ════════════════════ COLUMNA IZQUIERDA ════════════════════ */}
          <div className="lg:col-span-8 space-y-4">

            {/* ── Datos Personales ── */}
            <section className={cardCls}>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Datos Personales</h2>
              <form onSubmit={handleSaveProfile} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-600">Nombre completo</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      className={inputCls} placeholder="Tu nombre" required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-600">Teléfono</label>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      className={inputCls} placeholder="+54 11 1234-5678" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-600">Documento</label>
                  <div className="flex gap-2">
                    {/* Selector tipo documento — segmented control del template */}
                    <div className="flex bg-slate-100 border border-[#bdcaba] rounded-lg p-1 flex-shrink-0">
                      {["DNI", "CUIT", "CUIL"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setDocumentType(type)}
                          className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                            documentType === type
                              ? "bg-slate-900 text-white shadow-sm"
                              : "text-slate-500 hover:bg-slate-200"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <input type="text" value={cuit} onChange={(e) => setCuit(e.target.value)}
                      className={`${inputCls} flex-1`}
                      placeholder={documentType === "DNI" ? "12345678" : "20-12345678-9"} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-600">Tipo de cuenta</label>
                  <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${
                    customer.type === "MAYORISTA"
                      ? "bg-[#dbe1ff] text-[#003ea8]"
                      : "bg-blue-100 text-blue-700"
                  }`}>
                    {customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                  </span>
                </div>

                {/* Botón guardar — usa primary-container del template (#00873a) */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="w-full md:w-auto px-12 py-3 bg-[#00873a] hover:brightness-110 text-white font-semibold rounded-lg shadow-sm active:scale-[0.98] transition-all disabled:opacity-60 text-sm"
                  >
                    {savingProfile ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </section>

            {/* ── Email + Contraseña (2 columnas en md+) ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Email */}
              <section className={`${cardCls} flex flex-col justify-between`}>
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Email</h2>
                    {(!emailRequest || emailRequest.status !== "PENDING") && (
                      <button
                        onClick={() => { setEmailSection((v) => !v); setNewEmail(""); setEmailReason(""); }}
                        className="text-xs text-blue-500 hover:underline font-medium"
                      >
                        {emailSection ? "Cancelar" : "Solicitar cambio"}
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 mb-4">{customer.email}</p>

                  {emailRequest?.status === "PENDING" && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800 space-y-0.5">
                      <p className="font-semibold">⏳ Solicitud pendiente</p>
                      <p>Email solicitado: <span className="font-medium">{emailRequest.newEmail}</span></p>
                    </div>
                  )}
                  {emailRequest?.status === "APPROVED" && (
                    <div className="bg-[#7ffc97]/20 border border-[#7ffc97]/40 rounded-lg px-3 py-2.5 text-xs text-green-800 flex items-center gap-2">
                      <span className="material-symbols-outlined text-green-600" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      <span className="font-medium">Último cambio aprobado</span>
                    </div>
                  )}
                  {emailRequest?.status === "REJECTED" && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700 space-y-0.5">
                      <p className="font-semibold">❌ Solicitud rechazada</p>
                      {emailRequest.adminNotes && <p>{emailRequest.adminNotes}</p>}
                    </div>
                  )}

                  {emailSection && (
                    <form onSubmit={handleRequestEmailChange} className="space-y-3 pt-3 border-t border-slate-100 mt-3">
                      <p className="text-xs text-slate-400">Tu solicitud será revisada por el administrador.</p>
                      <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                        className={inputCls} placeholder="nuevo@email.com" required />
                      <textarea value={emailReason} onChange={(e) => setEmailReason(e.target.value)}
                        rows={2} className={`${inputCls} resize-none`}
                        placeholder="¿Por qué querés cambiarlo?" required />
                      <button type="submit" disabled={savingEmail}
                        className="w-full py-2.5 bg-[#00873a] text-white rounded-lg text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition-all">
                        {savingEmail ? "Enviando..." : "Enviar solicitud"}
                      </button>
                    </form>
                  )}
                </div>
              </section>

              {/* Contraseña */}
              <section className={`${cardCls} flex flex-col justify-between`}>
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Contraseña</h2>
                    <button
                      onClick={() => setPwdSection((v) => !v)}
                      className="text-xs text-blue-500 hover:underline font-medium"
                    >
                      {pwdSection ? "Cancelar" : "Cambiar contraseña"}
                    </button>
                  </div>
                  {!pwdSection ? (
                    <>
                      <p className="text-sm text-slate-400 tracking-widest mb-4">••••••••</p>
                      <p className="text-xs text-slate-400 italic">Seguridad de cuenta: Alta</p>
                    </>
                  ) : (
                    <form onSubmit={handleChangePassword} className="space-y-3 mt-1">
                      <input type="password" value={pwdForm.current}
                        onChange={(e) => setPwdForm((p) => ({ ...p, current: e.target.value }))}
                        className={inputCls} placeholder="Contraseña actual" required />
                      <input type="password" value={pwdForm.newPwd}
                        onChange={(e) => setPwdForm((p) => ({ ...p, newPwd: e.target.value }))}
                        className={inputCls} placeholder="Nueva (mín. 6 caracteres)" required />
                      <input type="password" value={pwdForm.confirm}
                        onChange={(e) => setPwdForm((p) => ({ ...p, confirm: e.target.value }))}
                        className={inputCls} placeholder="Confirmar nueva contraseña" required />
                      {pwdForm.confirm && pwdForm.newPwd !== pwdForm.confirm && (
                        <p className="text-xs text-red-500">Las contraseñas no coinciden</p>
                      )}
                      <button type="submit" disabled={savingPwd}
                        className="w-full py-2.5 bg-[#00873a] text-white rounded-lg text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition-all">
                        {savingPwd ? "Guardando..." : "Guardar contraseña"}
                      </button>
                      <p className="text-xs text-slate-400 text-center">
                        ¿No recordás tu contraseña?{" "}
                        <button type="button" onClick={handleSendResetLink} className="text-blue-500 hover:underline">
                          Enviarme un link
                        </button>
                      </p>
                    </form>
                  )}
                </div>
              </section>
            </div>

            {/* ── Recordatorios de restock (solo MAYORISTA) ── */}
            {customer.type === "MAYORISTA" && (
              <section className={`${cardCls} flex justify-between items-center`}>
                <div className="space-y-1">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Recordatorios de restock</h2>
                  <p className="text-xs text-slate-400">
                    {unsubscribeRestock
                      ? "No estás recibiendo recordatorios de restock por email."
                      : "Recibís un email cuando lleva tiempo sin hacerse un pedido."}
                  </p>
                </div>
                {/* Toggle switch — diseño del template */}
                <button
                  type="button"
                  onClick={handleToggleRestock}
                  disabled={savingRestock}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
                    !unsubscribeRestock ? "bg-[#00873a]" : "bg-[#bdcaba]"
                  }`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                    !unsubscribeRestock ? "translate-x-5" : "translate-x-0.5"
                  }`} />
                </button>
              </section>
            )}

            {/* ── Solicitud para pasar a Mayorista (solo MINORISTA) ── */}
            {customer.type === "MINORISTA" && (
              <section className={cardCls}>
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Cuenta Mayorista</h2>
                {(() => {
                  const canApply = !mayoristaRequest
                    || mayoristaRequest.status === "REJECTED"
                    || (mayoristaRequest.status === "APPROVED" && customer.type === "MINORISTA");
                  const hasPending = mayoristaRequest?.status === "PENDING";
                  return (
                    <>
                      {canApply && !mayoristaFormOpen && (
                        <div className="flex items-start gap-4">
                          <div className="flex-1">
                            <p className="text-sm text-slate-700 font-medium">¿Sos revendedor o comprás por mayor?</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Solicitá acceso a la cuenta Mayorista para ver precios y condiciones especiales.
                            </p>
                          </div>
                          <button onClick={() => setMayoristaFormOpen(true)}
                            className="flex-shrink-0 px-4 py-2 bg-[#dbe1ff] text-[#003ea8] rounded-lg text-sm font-semibold hover:brightness-95 transition-all">
                            Solicitar
                          </button>
                        </div>
                      )}
                      {hasPending && !mayoristaFormOpen && (
                        <div className="flex items-center gap-3 p-3 rounded-xl text-sm bg-yellow-50 border border-yellow-200">
                          <span className="text-lg">⏳</span>
                          <div>
                            <p className="font-medium text-yellow-800">Solicitud pendiente de revisión</p>
                            <p className="text-xs text-yellow-600 mt-0.5">El administrador la revisará pronto.</p>
                          </div>
                        </div>
                      )}
                      {mayoristaFormOpen && (
                        <form onSubmit={handleSendMayoristaRequest} className="space-y-3">
                          <p className="text-xs text-slate-500">Podés agregar un mensaje opcional explicando tu actividad.</p>
                          <textarea value={mayoristaMessage} onChange={(e) => setMayoristaMessage(e.target.value)}
                            rows={3} placeholder="Ej: Soy revendedor de electrónica, tengo local en Mendoza..."
                            className={`${inputCls} resize-none`} />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => { setMayoristaFormOpen(false); setMayoristaMessage(""); }}
                              className="flex-1 py-2 border border-[#bdcaba] rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                              Cancelar
                            </button>
                            <button type="submit" disabled={sendingRequest}
                              className="flex-1 py-2 bg-[#dbe1ff] text-[#003ea8] rounded-lg text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition-all">
                              {sendingRequest ? "Enviando..." : "Enviar solicitud"}
                            </button>
                          </div>
                        </form>
                      )}
                      {mayoristaRequest?.status === "APPROVED" && customer.type === "MINORISTA" && !mayoristaFormOpen && (
                        <div className="flex items-center gap-3 p-3 rounded-xl text-sm bg-green-50 border border-green-200 mt-3">
                          <span className="text-lg">✅</span>
                          <p className="text-green-800 text-xs">Tu cuenta fue modificada por el administrador. Podés volver a solicitar.</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>
            )}

            {/* ── Cerrar sesión — error/red del template ── */}
            <button
              onClick={() => { customerLogout(); navigate("/"); }}
              className="w-full py-4 border-2 border-red-600/20 text-red-600 font-semibold rounded-xl hover:bg-red-50 transition-all active:scale-[0.99] text-sm"
            >
              Cerrar sesión
            </button>
          </div>

          {/* ════════════════════ COLUMNA DERECHA ════════════════════ */}
          <div className="lg:col-span-4 space-y-4">

            {/* ── Acciones Rápidas — surface-container-high del template (#dce9ff) ── */}
            <div className="bg-[#dce9ff] rounded-xl p-6 border border-[#bdcaba]/50">
              <h3 className="font-semibold text-slate-800 mb-4 text-base" style={{ fontFamily: "Outfit, sans-serif" }}>
                Acciones Rápidas
              </h3>
              <ul className="space-y-3">

                {/* Historial de pedidos */}
                <li>
                  <button
                    onClick={() => navigate("/pedidos")}
                    className="w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-[#bdcaba] hover:border-blue-400 hover:shadow-sm transition-all text-left"
                  >
                    <span className="material-symbols-outlined text-blue-600">receipt_long</span>
                    <span className="text-sm font-medium text-slate-800">Historial de pedidos</span>
                  </button>
                </li>

                {/* Direcciones de envío — comentada: usuario pidió quitarla */}
                {/* <li>
                  <button className="w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-[#bdcaba] hover:border-blue-400 transition-all text-left">
                    <span className="material-symbols-outlined text-blue-600">location_on</span>
                    <span className="text-sm font-medium text-slate-800">Direcciones de envío</span>
                  </button>
                </li> */}

                {/* Ayuda por WhatsApp — reemplaza "Centro de ayuda" con mensaje pre-armado */}
                <li>
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-[#bdcaba] hover:border-green-400 hover:shadow-sm transition-all"
                  >
                    <WhatsAppIcon className="w-6 h-6 text-green-500" />
                    <span className="text-sm font-medium text-slate-800">Ayuda por WhatsApp</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* ── FAB flotante de WhatsApp — comentado porque ya existe un botón global de soporte
           en todas las páginas que pisa este; no se necesita uno específico acá ── */}
      {/* <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-8 right-8 z-50 flex items-center gap-2 bg-[#25D366] text-white px-4 py-3 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all font-semibold text-sm"
        title="Contactar por WhatsApp"
      >
        <WhatsAppIcon className="w-5 h-5" />
        <span>Soporte</span>
      </a> */}
    </div>
  );
}
