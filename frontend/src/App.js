import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { applyPageMetadata, DEFAULT_DESCRIPTION } from "@/lib/seo";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import Clubs from "@/pages/Clubs";
import Landing from "@/pages/Landing";
import ClubHome from "@/pages/ClubHome";
import ClubCalendar from "@/pages/ClubCalendar";
import Class from "@/pages/Class";
import Regatta from "@/pages/Regatta";
import Race from "@/pages/Race";
import Boats from "@/pages/Boats";
import Boat from "@/pages/Boat";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Officer from "@/pages/Officer";
import NoticeWizard from "@/pages/NoticeWizard";
import SubscriptionManager from "@/pages/SubscriptionManager";
import SubscriptionVerify from "@/pages/SubscriptionVerify";
import NoticeBoardPage from "@/pages/NoticeBoardPage";
import Admin from "@/pages/Admin";
import Webmaster from "@/pages/Webmaster";
import Help from "@/pages/Help";
import HelpSidebar from "@/components/HelpSidebar";

function Protected({ children, allow }) {
  const { role } = useAuth();
  const location = useLocation();
  if (role === undefined) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  }
  if (!allow.includes(role)) {
    // Preserve where the visitor was headed so the login page can return them
    // there after a successful sign-in (see Login.jsx canReturnTo).
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

const PRIVATE_ROUTES = [
  /^\/(admin|officer|webmaster)(?:\/[^/]+)*\/?$/,
  /^\/notice\/new(?:\/[^/]+)*\/?$/,
  /^\/(login|forgot-password|reset-password)(?:\/[^/]+)*\/?$/,
  /^\/subscriptions(?:\/[^/]+)*\/?$/,
];

function RouteMetadata() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    const isPrivate = PRIVATE_ROUTES.some((route) => route.test(path));
    const isUnknownRoute = ![
      /^\/$/,
      /^\/club\/[^/]+(?:\/calendar|\/notice-board)?\/?$/,
      /^\/club\/[^/]+\/series\/[^/]+(?:\/[^/]+)?\/?$/,
      /^\/club\/[^/]+\/(?:race|regatta|competition)\/[^/]+(?:\/[^/]+)?\/?$/,
      /^\/class\/[^/]+(?:\/[^/]+)?\/?$/,
      /^\/class\/group\/[^/]+(?:\/[^/]+)?\/?$/,
      /^\/boat\/[^/]+(?:\/[^/]+)?\/?$/,
      /^\/boats\/?$/,
      /^\/help(?:\/quick-start\/[^/]+)?\/?$/,
      /^\/faq\/?$/,
    ].some((route) => route.test(path));
    let active = true;
    const applyFallback = () => {
      if (!active) return;
      applyPageMetadata({
        title: isPrivate ? "Private SailScore workspace" : "Club Sailing Results & Standings | SailScore",
        description: isPrivate || isUnknownRoute ? "This page is not available for public search indexing." : DEFAULT_DESCRIPTION,
        canonical: `${window.location.origin}${path}`,
        robots: isPrivate || isUnknownRoute ? "noindex,nofollow" : "index,follow",
      });
    };
    applyFallback();
    if (!isPrivate && !isUnknownRoute) {
      const uri = `${path}${location.search}`;
      fetch(`/api/seo-meta?uri=${encodeURIComponent(uri)}`, { credentials: "omit" })
        .then((response) => response.ok ? response.json() : null)
        .then((metadata) => { if (active && metadata) applyPageMetadata(metadata); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [location.pathname, location.search]);
  return null;
}

function PersistentHelpSidebar() {
  const location = useLocation();
  return <HelpSidebar showTrigger={false} pathname={location.pathname} />;
}

function App() {
  return (
    <div className="App">
      <ThemeProvider>
      <TooltipProvider delayDuration={200}>
      <AuthProvider>
        <BrowserRouter>
          <RouteMetadata />
          <PersistentHelpSidebar />
          <Routes>
            <Route path="/" element={<Clubs />} />
            <Route path="/club/:slug" element={<ClubHome />} />
            <Route path="/club/:slug/calendar" element={<ClubCalendar />} />
            <Route path="/club/:slug/series/:seriesId/:seriesName?" element={<Landing />} />
            <Route path="/class/group/:classKey/:className?" element={<Class />} />
            <Route path="/class/:classId/:className?" element={<Class />} />
            <Route path="/club/:slug/race/:raceId/:raceName?" element={<Race />} />
            <Route path="/club/:slug/regatta/:regattaId/:eventName?" element={<Regatta />} />
            <Route path="/club/:slug/competition/:regattaId/:eventName?" element={<Regatta />} />
            <Route path="/club/:slug/notice-board" element={<NoticeBoardPage />} />
            <Route path="/boats" element={<Boats />} />
            <Route path="/boat/:fleetId/:boatName?" element={<Boat />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/officer" element={<Protected allow={["officer", "admin", "webmaster"]}><Officer /></Protected>} />
            <Route path="/notice/new" element={<Protected allow={["officer", "admin", "webmaster"]}><NoticeWizard /></Protected>} />
            <Route path="/subscriptions/manage" element={<SubscriptionManager />} />
            <Route path="/subscriptions/verify" element={<SubscriptionVerify />} />
            <Route path="/admin" element={<Protected allow={["admin", "webmaster"]}><Admin /></Protected>} />
            <Route path="/webmaster" element={<Protected allow={["webmaster"]}><Webmaster /></Protected>} />
            <Route path="/help" element={<Help />} />
            <Route path="/faq" element={<Help />} />
            <Route path="/help/quick-start/:guide" element={<Help />} />
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
