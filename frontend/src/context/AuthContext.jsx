import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(undefined); // undefined = checking
  const [clubId, setClubId] = useState(null);
  const [clubName, setClubName] = useState(null);
  const [username, setUsername] = useState(null);
  const [userName, setUserName] = useState(null);

  // The session token lives in an HttpOnly cookie the browser attaches
  // automatically — we just ask the server who we are. No localStorage.
  useEffect(() => {
    api.me().then((d) => {
      setRole(d.role);
      setClubId(d.club_id);
      setClubName(d.club_name || null);
      setUsername(d.username || null);
      setUserName(d.name || null);
    }).catch(() => {
      setRole(null);
    });
  }, []);

  // Apply a login / change-passcode payload (role, club, name — the fresh
  // session cookie is already set by the server).
  const updateSession = (data) => {
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
    api.logout().catch(() => {});
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
