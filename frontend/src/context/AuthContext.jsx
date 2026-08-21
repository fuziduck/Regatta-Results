import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(undefined); // undefined = checking
  const [clubId, setClubId] = useState(null);
  const [clubName, setClubName] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("scr_token");
    if (!token) {
      setRole(null);
      return;
    }
    api.me().then((d) => {
      setRole(d.role);
      setClubId(d.club_id);
      setClubName(d.club_name || null);
    }).catch(() => {
      localStorage.removeItem("scr_token");
      setRole(null);
    });
  }, []);

  const login = async (r, pin, club_id) => {
    const data = await api.login(r, pin, club_id);
    localStorage.setItem("scr_token", data.token);
    setRole(data.role);
    setClubId(data.club_id);
    setClubName(data.club_name);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("scr_token");
    setRole(null);
    setClubId(null);
    setClubName(null);
  };

  return (
    <AuthContext.Provider value={{ role, clubId, clubName, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
