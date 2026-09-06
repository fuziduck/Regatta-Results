import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogIn, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

// Public-header entry point for officials. Anonymous visitors get the
// sign-in link; a signed-in officer/admin/webmaster goes straight back to
// their console — never to the login form, which read as having been
// logged out after using a console's "View site" link.
const CONSOLE_BY_ROLE = {
  officer: { path: "/officer", label: "Officer console" },
  admin: { path: "/admin", label: "Admin console" },
  webmaster: { path: "/webmaster", label: "Webmaster" },
};

export default function OfficialsLink() {
  const { role } = useAuth();
  const dest = CONSOLE_BY_ROLE[role];
  return (
    <Link to={dest ? dest.path : "/login"}>
      <Button variant="outline" size="sm" data-testid="officials-login-btn" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">
        {dest
          ? <><LayoutDashboard className="w-4 h-4" /> {dest.label}</>
          : <><LogIn className="w-4 h-4" /> Officials</>}
      </Button>
    </Link>
  );
}
