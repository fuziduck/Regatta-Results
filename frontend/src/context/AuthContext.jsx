import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(undefined); // undefined = checking
  const [clubId, setClubId] = useState(null);
  const [clubName, setClubName] = useState(null);
  const [username, setUsername] = useState(null);
  const [userName, setUserName] = useState(null);

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
      setUsername(d.username || null);
      setUserName(d.name || null);
    }).catch(() => {
      localStorage.removeItem("scr_token");
      setRole(null);
    });
  }, []);

  // Store a login-shaped payload ({token, role, club_id, club_name, ...}).
  const updateSession = (data) => {
    localStorage.setItem("scr_token", data.token);
    setRole(data.role);
    setClubId(data.club_id);
    setClubName(data.club_name || null);
    setUsername(data.username || null);
    setUserName(data.name || null);
  };

  const login = async (r, username_, passcode, club_id) => {
    const data = await api.login(r, username_, passcode, club_id);
    updateSession(data);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("scr_token");
    setRole(null);
    setClubId(null);
    setClubName(null);
    setUsername(null);
    setUserName(null);
  };

  return (
    <AuthContext.Provider value={{ role, clubId, clubName, username, userName, login, logout, updateSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
