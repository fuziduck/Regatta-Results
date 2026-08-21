import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Clubs from "@/pages/Clubs";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Officer from "@/pages/Officer";
import Admin from "@/pages/Admin";
import Webmaster from "@/pages/Webmaster";

function Protected({ children, allow }) {
  const { role } = useAuth();
  if (role === undefined) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  }
  if (!allow.includes(role)) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Clubs />} />
            <Route path="/club/:slug" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/officer" element={<Protected allow={["officer", "admin", "webmaster"]}><Officer /></Protected>} />
            <Route path="/admin" element={<Protected allow={["admin", "webmaster"]}><Admin /></Protected>} />
            <Route path="/webmaster" element={<Protected allow={["webmaster"]}><Webmaster /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
