import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { authApi, adminUsersApi } from "../../services/api";
import toast from "react-hot-toast";

const ALL_PERMISSIONS = [
  { key: "productos",      label: "Productos" },
  { key: "ordenes",        label: "Órdenes" },
  { key: "clientes",       label: "Clientes" },
  { key: "categorias",     label: "Categorías" },
  { key: "metricas",       label: "Métricas" },
  { key: "cupones",        label: "Cupones" },
  { key: "caja",           label: "Caja" },
  { key: "compras",        label: "Compras" },
  { key: "carrusel",       label: "Carrusel" },
  { key: "configuracion",  label: "Configuración" },
  { key: "devoluciones",   label: "Devoluciones" },
  { key: "flyer",          label: "Generador de Flyers" },
  { key: "finanzas",       label: "Ver finanzas (dashboard)" },
];

function PermissionCheckboxes({ value, onChange }) {
  const toggle = (key) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {ALL_PERMISSIONS.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={value.includes(key)} onChange={() => toggle(key)} className="w-4 h-4 rounded accent-blue-500" />
          <span className="text-sm text-slate-300">{label}</span>
        </label>
      ))}
    </div>
  );
}

// ── Tab: Mi perfil ─────────────────────────────────────────────────────────────
function MyProfileTab() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const handleProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ name, email });
      toast.success("Perfil actualizado");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar perfil");
    } finally { setSaving(false); }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("Las contraseñas no coinciden");
    setSavingPwd(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast.success("Contraseña actualizada");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al cambiar contraseña");
    } finally { setSavingPwd(false); }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h3 className="text-base font-semibold text-slate-100 mb-4">Datos del perfil</h3>
        <form onSubmit={handleProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nombre</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </div>

      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h3 className="text-base font-semibold text-slate-100 mb-4">Cambiar contraseña</h3>
        <form onSubmit={handlePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Contraseña actual</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nueva contraseña</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Confirmar nueva contraseña</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <button type="submit" disabled={savingPwd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {savingPwd ? "Guardando..." : "Cambiar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Administradores ───────────────────────────────────────────────────────
function AdminsTab() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [resetId, setResetId] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [savingReset, setSavingReset] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({ name: "", email: "", password: "", permissions: [] });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminUsersApi.getAll();
      setAdmins(res.data);
    } catch { toast.error("Error al cargar admins"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (admin) => {
    setEditingId(admin.id);
    setEditData({ name: admin.name || "", email: admin.email, permissions: admin.permissions });
  };

  const saveEdit = async () => {
    try {
      await adminUsersApi.update(editingId, editData);
      toast.success("Admin actualizado");
      setEditingId(null); load();
    } catch (err) { toast.error(err.response?.data?.error || "Error al actualizar"); }
  };

  const handleDelete = async (id, email) => {
    if (!confirm(`¿Eliminar al admin ${email}?`)) return;
    try {
      await adminUsersApi.remove(id);
      toast.success("Admin eliminado"); load();
    } catch (err) { toast.error(err.response?.data?.error || "Error al eliminar"); }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setSavingReset(true);
    try {
      await adminUsersApi.resetPassword(resetId, newPwd);
      toast.success("Contraseña reseteada");
      setResetId(null); setNewPwd("");
    } catch (err) { toast.error(err.response?.data?.error || "Error al resetear"); }
    finally { setSavingReset(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await adminUsersApi.create(createData);
      toast.success("Admin creado");
      setShowCreate(false);
      setCreateData({ name: "", email: "", password: "", permissions: [] });
      load();
    } catch (err) { toast.error(err.response?.data?.error || "Error al crear admin"); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
          {showCreate ? "Cancelar" : "+ Nuevo admin"}
        </button>
      </div>

      {showCreate && (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
          <h3 className="text-base font-semibold text-slate-100 mb-4">Crear administrador</h3>
          <form onSubmit={handleCreate} className="space-y-4" autoComplete="off">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nombre (opcional)</label>
                <input type="text" value={createData.name} onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
                  placeholder="Nombre del admin"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Email *</label>
                <input type="email" value={createData.email} onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
                  required autoComplete="off"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1">Contraseña *</label>
                <input type="password" value={createData.password} onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                  required minLength={6} autoComplete="new-password"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Permisos</label>
              <PermissionCheckboxes value={createData.permissions} onChange={(perms) => setCreateData({ ...createData, permissions: perms })} />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={creating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                {creating ? "Creando..." : "Crear admin"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">Cargando...</div>
      ) : admins.length === 0 ? (
        <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 text-center text-slate-400">
          No hay otros administradores creados aún.
        </div>
      ) : (
        <div className="space-y-4">
          {admins.map((admin) => (
            <div key={admin.id} className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
              {editingId === admin.id ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Nombre</label>
                      <input type="text" value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
                      <input type="email" value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">Permisos</label>
                    <PermissionCheckboxes value={editData.permissions} onChange={(perms) => setEditData({ ...editData, permissions: perms })} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={saveEdit}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                      Guardar
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      {admin.name && <p className="text-sm font-semibold text-slate-100">{admin.name}</p>}
                      <p className="text-sm text-slate-400">{admin.email}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Creado: {new Date(admin.createdAt).toLocaleDateString("es-AR")}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => startEdit(admin)}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors">Editar</button>
                      <button onClick={() => { setResetId(admin.id); setNewPwd(""); }}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors">Clave</button>
                      <button onClick={() => handleDelete(admin.id, admin.email)}
                        className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-300 rounded-lg text-xs font-medium transition-colors">Eliminar</button>
                    </div>
                  </div>
                  {admin.permissions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {admin.permissions.map((p) => (
                        <span key={p} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">
                          {ALL_PERMISSIONS.find((x) => x.key === p)?.label || p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500 italic">Sin permisos asignados</p>
                  )}
                </div>
              )}

              {resetId === admin.id && (
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <form onSubmit={handleReset} className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-400 mb-1">Nueva contraseña</label>
                      <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                        required minLength={6} autoFocus
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
                    </div>
                    <button type="submit" disabled={savingReset}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0">
                      {savingReset ? "..." : "Resetear"}
                    </button>
                    <button type="button" onClick={() => setResetId(null)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors shrink-0">
                      Cancelar
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente principal exportado (sin AdminLayout) ──────────────────────────
export default function UsersSectionContent() {
  const [tab, setTab] = useState("perfil");

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex gap-1 bg-slate-800 p-1 rounded-xl w-fit">
        {[
          { key: "perfil",  label: "Mi perfil" },
          { key: "admins",  label: "Administradores" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "perfil" && <MyProfileTab />}
      {tab === "admins" && <AdminsTab />}
    </div>
  );
}
