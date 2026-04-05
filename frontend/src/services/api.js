import axios from "axios";

// La URL base de la API viene de la variable de entorno de Vite
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Interceptor: adjunta el token JWT automáticamente si existe en localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Instancia separada que usa el token de CUSTOMER (no el de admin)
const customerAuthApi = axios.create({
  baseURL: `${API_URL}/api`,
});
customerAuthApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("customer_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor de respuesta: si el token expiró, redirige al login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_user");
      // Solo redirige al login si estamos en una ruta de admin
      if (window.location.pathname.startsWith("/admin")) {
        window.location.href = "/admin/login";
      }
    }
    return Promise.reject(error);
  }
);

// ─── Productos ────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (params) => api.get("/products", { params }),
  getAllAdmin: (params) => api.get("/products/admin/all", { params }),
  getById: (id) => api.get(`/products/${id}`),
  create: (formData) =>
    api.post("/products", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  update: (id, formData) =>
    api.put(`/products/${id}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  // Edición rápida: actualiza precio, stock, precios especiales y estado sin multipart
  // Soporta: price, salePrice, wholesalePrice, wholesaleSalePrice, stock, stockUnlimited, minQuantity, active
  quickUpdate: (id, data) => api.patch(`/products/${id}/quick`, data),
  delete: (id) => api.delete(`/products/${id}`),
};

// ─── Categorías ───────────────────────────────────────────────────────────────
export const categoriesApi = {
  getAll: () => api.get("/categories"),
  create: (data) => api.post("/categories", data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  delete: (id) => api.delete(`/categories/${id}`),
};

// ─── Órdenes ──────────────────────────────────────────────────────────────────
export const ordersApi = {
  create: (data) => api.post("/orders", data),
  getAll: (params) => api.get("/orders", { params }),
  getById: (id) => api.get(`/orders/${id}`),
  updateStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }),
  getStats: () => api.get("/orders/stats"),
  getMetrics: () => api.get("/orders/metrics"),
  delete: (id) => api.delete(`/orders/${id}`),
  // Cliente: historial de pedidos propios (APPROVED)
  getMy: () => customerAuthApi.get("/orders/my"),
  // Cliente MAYORISTA: cotizaciones enviadas (paymentMethod: COTIZACION)
  getMyCotizaciones: () => customerAuthApi.get("/orders/my-quotes"),
  // Admin: editar/eliminar un item de una cotización
  updateItem: (orderId, itemId, quantity, price) => api.patch(`/orders/${orderId}/items/${itemId}`, { quantity, ...(price !== undefined && { price }) }),
  deleteItem: (orderId, itemId) => api.delete(`/orders/${orderId}/items/${itemId}`),
  // Admin: publicar cambios de items al cliente (actualiza snapshot + notifica)
  publishCotizacion: (orderId, adminNotes) => api.post(`/orders/${orderId}/publish`, { adminNotes }),
  // Admin: aprobar cotización
  approveCotizacion: (orderId, adminNotes) => api.post(`/orders/${orderId}/approve`, { adminNotes }),
  // Cliente: cancelar su cotización con motivo
  cancelCotizacion: (orderId, reason) => customerAuthApi.post(`/orders/${orderId}/cancel-by-customer`, { reason }),
  // Cliente: obtener una cotización propia por ID (para la página de pago)
  getMyQuoteById: (id) => customerAuthApi.get(`/orders/my-quotes/${id}`),
  // Cliente MAYORISTA: confirmar pago manual (efectivo o transferencia) — envía emails
  confirmCotizacionPayment: (orderId, paymentMethod) =>
    customerAuthApi.post(`/orders/${orderId}/confirm-payment`, { paymentMethod }),
};

// ─── Pagos ────────────────────────────────────────────────────────────────────
export const paymentsApi = {
  createPreference: (orderId) =>
    api.post("/payments/create-preference", { orderId }),
  getOrderStatus: (orderId) =>
    api.get(`/payments/order/${orderId}/status`),
  // Cliente: crear preferencia de MP para pagar una cotización aprobada
  createCotizacionPreference: (orderId) =>
    customerAuthApi.post("/payments/cotizacion-preference", { orderId }),
};

// ─── Clientes ─────────────────────────────────────────────────────────────────
export const customersApi = {
  register: (data) => api.post("/customers/register", data),
  login: (data) => api.post("/customers/login", data),
  getAll: (params) => api.get("/customers", { params }),
  updateStatus: (id, status, notes) => api.patch(`/customers/${id}/status`, { status, notes }),
  updateType: (id, type) => api.patch(`/customers/${id}/type`, { type }),
  update: (id, data) => api.put(`/customers/${id}`, data),
  delete: (id) => api.delete(`/customers/${id}`),
  // Self-service: el cliente gestiona su propio perfil con su token
  getMe: () => customerAuthApi.get("/customers/me"),
  updateMe: (data) => customerAuthApi.put("/customers/me", data),
  changeEmail: (data) => customerAuthApi.put("/customers/me/email", data),
  uploadAvatar: (formData) => customerAuthApi.post("/customers/me/avatar", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};

// ─── Solicitudes Mayorista ────────────────────────────────────────────────────
export const mayoristaRequestsApi = {
  // Cliente: enviar solicitud y consultar la propia
  create: (data) => customerAuthApi.post("/mayorista-requests", data),
  getMy:  ()     => customerAuthApi.get("/mayorista-requests/my"),
  // Admin: listar y gestionar todas las solicitudes
  getAll:  (params) => api.get("/mayorista-requests", { params }),
  approve: (id)     => api.patch(`/mayorista-requests/${id}/approve`),
  reject:  (id)     => api.patch(`/mayorista-requests/${id}/reject`),
};

// ─── Carritos ─────────────────────────────────────────────────────────────────
export const cartsApi = {
  // Cliente: obtener su propio carrito (con stock del producto)
  getMe: () => customerAuthApi.get("/carts/me"),
  // Cliente: agregar un item al carrito (crea el carrito si no existe)
  addItem: (data) => customerAuthApi.post("/carts/my/items", data),
  // Cliente: cambiar cantidad de un item propio
  updateMyItem: (itemId, quantity) => customerAuthApi.patch(`/carts/my/items/${itemId}`, { quantity }),
  // Cliente: eliminar un item de su propio carrito
  removeMyItem: (itemId) => customerAuthApi.delete(`/carts/my/items/${itemId}`),
  // Cliente: limpiar su propio carrito (usado en checkout después del pago)
  clearMyCart: () => customerAuthApi.delete("/carts/my"),

  // Admin: ver todos los carritos activos con items
  getAll: () => api.get("/carts"),
  // Admin: limpiar todo el carrito de un cliente
  clearCart: (customerId) => api.delete(`/carts/${customerId}`),
  // Admin: cambiar cantidad de un item individual
  updateItem: (itemId, quantity) => api.patch(`/carts/items/${itemId}`, { quantity }),
  // Admin: eliminar un item individual del carrito
  deleteItem: (itemId) => api.delete(`/carts/items/${itemId}`),

  // [DEPRECADO] Sincronización por debounce — reemplazada por operaciones directas
  // sync: (items) => customerAuthApi.put("/carts/sync", { items }),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (credentials) => api.post("/auth/login", credentials),
  me: () => api.get("/auth/me"),
  changePassword: (data) => api.put("/auth/change-password", data),
};

// ─── Gastos / Caja ────────────────────────────────────────────────────────────
export const gastosApi = {
  getAll: (type) => api.get("/gastos", { params: type ? { type } : {} }),
  create: (data) => api.post("/gastos", data),
  remove: (id)  => api.delete(`/gastos/${id}`),
};

// ─── Notificaciones ───────────────────────────────────────────────────────────
export const notificationsApi = {
  getMy:       () => customerAuthApi.get("/notifications/my"),
  markAllRead: () => customerAuthApi.patch("/notifications/read-all"),
};

export const getImageUrl = (path) => {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
};

export default api;
