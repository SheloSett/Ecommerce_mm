import { createContext, useContext, useState, useEffect } from "react";
import { customersApi } from "../services/api";

const CustomerAuthContext = createContext(null);

export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);

  // Al montar, restaurar sesión de localStorage si existe
  useEffect(() => {
    const token = localStorage.getItem("customer_token");
    const saved = localStorage.getItem("customer_user");

    if (token && saved) {
      setCustomer(JSON.parse(saved));
    }
    setLoadingCustomer(false);
  }, []);

  const customerLogin = async (email, password) => {
    const res = await customersApi.login({ email, password });
    const { token, customer: customerData } = res.data;
    localStorage.setItem("customer_token", token);
    localStorage.setItem("customer_user", JSON.stringify(customerData));
    setCustomer(customerData);
    return customerData;
  };

  const customerLogout = () => {
    localStorage.removeItem("customer_token");
    localStorage.removeItem("customer_user");
    setCustomer(null);
  };

  // Actualiza los datos del cliente en el estado y en localStorage sin cerrar sesión
  const updateCustomerData = (newData) => {
    const updated = { ...customer, ...newData };
    localStorage.setItem("customer_user", JSON.stringify(updated));
    setCustomer(updated);
  };

  // Actualiza datos Y token (necesario cuando cambia el email)
  const updateCustomerWithToken = (token, newData) => {
    localStorage.setItem("customer_token", token);
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
