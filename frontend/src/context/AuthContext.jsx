import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(undefined); // undefined = checking

  useEffect(() => {
    const token = localStorage.getItem("scr_token");
    if (!token) {
      setRole(null);
      return;
    }
    api.me().then((d) => setRole(d.role)).catch(() => {
      localStorage.removeItem("scr_token");
      setRole(null);
    });
  }, []);

  const login = async (r, pin) => {
    const data = await api.login(r, pin);
    localStorage.setItem("scr_token", data.token);
    setRole(data.role);
    return data.role;
  };

  const logout = () => {
    localStorage.removeItem("scr_token");
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
