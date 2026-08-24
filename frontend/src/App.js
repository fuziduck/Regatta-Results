import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import Clubs from "@/pages/Clubs";
import Landing from "@/pages/Landing";
import Boats from "@/pages/Boats";
import Boat from "@/pages/Boat";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
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
      <ThemeProvider>
      <TooltipProvider delayDuration={200}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Clubs />} />
            <Route path="/club/:slug" element={<Landing />} />
            <Route path="/boats" element={<Boats />} />
            <Route path="/boat/:fleetId" element={<Boat />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/officer" element={<Protected allow={["officer", "admin", "webmaster"]}><Officer /></Protected>} />
            <Route path="/admin" element={<Protected allow={["admin", "webmaster"]}><Admin /></Protected>} />
            <Route path="/webmaster" element={<Protected allow={["webmaster"]}><Webmaster /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </AuthProvider>
      </TooltipProvider>
      </ThemeProvider>
    </div>
  );
}

export default App;
