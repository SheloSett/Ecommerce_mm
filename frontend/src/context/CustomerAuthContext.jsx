import { createContext, useContext, useState, useEffect } from "react";
import { customersApi } from "../services/api";
import { storageGet, storageSet, storageRemove, storageGetJSON, isPlainObject } from "../utils/storage";

const CustomerAuthContext = createContext(null);

export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);

  // Al montar, restaurar sesión de localStorage si existe. Antes: JSON.parse directo. Con el dato guardado
  // roto (o sin acceso al almacenamiento) tiraba acá, y como este Provider envuelve toda la tienda, ese
  // visitante veía "Algo falló" en todas las páginas hasta borrar los datos del sitio.
  useEffect(() => {
    const token = storageGet("customer_token");
    const saved = storageGetJSON("customer_user", isPlainObject);
    if (token && saved) {
      setCustomer(saved);
    } else if (token || storageGet("customer_user")) {
      // Sesión a medias o rota: se limpia y el cliente vuelve a entrar
      storageRemove("customer_token");
      storageRemove("customer_user");
    }
    setLoadingCustomer(false);
  }, []);

  const customerLogin = async (email, password) => {
    const res = await customersApi.login({ email, password });
    const { token, customer: customerData } = res.data;
    storageSet("customer_token", token);
    storageSet("customer_user", JSON.stringify(customerData));
    setCustomer(customerData);
    return customerData;
  };

  const customerLogout = () => {
    storageRemove("customer_token");
    storageRemove("customer_user");
    setCustomer(null);
  };

  // Actualiza los datos del cliente en el estado y en localStorage sin cerrar sesión
  const updateCustomerData = (newData) => {
    const updated = { ...customer, ...newData };
    storageSet("customer_user", JSON.stringify(updated));
    setCustomer(updated);
  };

  // Actualiza datos Y token (necesario cuando cambia el email)
  const updateCustomerWithToken = (token, newData) => {
    storageSet("customer_token", token);
    updateCustomerData(newData);
  };

  return (
    <CustomerAuthContext.Provider value={{ customer, loadingCustomer, customerLogin, customerLogout, updateCustomerData, updateCustomerWithToken }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) throw new Error("useCustomerAuth debe usarse dentro de CustomerAuthProvider");
  return ctx;
}
