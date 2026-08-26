import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import ChangePasscodeDialog from "@/components/ChangePasscodeDialog";
import TwoFactorAuthDialog from "@/components/TwoFactorAuthDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, KeyRound, Menu, ShieldCheck } from "lucide-react";

// Console top-bar navigation, shared by the Race Officer, Race Admin and
// Webmaster consoles.
//
// Desktop (lg and up): every item renders as its own button in the bar and
// the Change passcode dialog sits alongside — exactly the previous layout.
// The widest realistic configuration (a webmaster in the Race Officer
// console: Switch club + Webmaster + Change passcode + Exit, plus the theme
// toggle and the club badge) measures ~943px, so below the lg breakpoint
// (1024px) the items would be pushed off the right edge of the viewport.
// Below lg they therefore collapse into a menu instead: the theme toggle
// stays in the bar and every other item — including Exit — stays one tap
// away inside the menu, so nothing is ever lost or pushed off-screen and no
// horizontal scrolling is needed. The menu is a standard Radix dropdown, so
// it is keyboard accessible (arrow keys, Escape) and opens/closes cleanly.
export default function ConsoleNav({
  items = [],
  meta = null,
  menuLabel = null,
  onChangedPasscode,
  logoutTestId,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const { logout, role } = useAuth();
  const navigate = useNavigate();

  // Club staff manage 2FA from the top bar; the webmaster has a dedicated
  // Security section in the webmaster console, so the item is hidden there.
  const showSecurity = !!role && role !== "webmaster";

  const visible = items.filter((i) => i.show !== false);

  const exit = () => {
    setMenuOpen(false);
    logout();
    navigate("/");
  };

  return (
    <div className="flex items-center gap-2">
      <ThemeToggle light />
      {meta && <span className="hidden lg:inline text-xs text-white/70 mr-1">{meta}</span>}

      {/* Desktop: full item row (unchanged behaviour at lg and up). The
          passcode dialog is controlled so the mobile menu can open the same
          instance; its portal content renders regardless of the row's
          display state on small screens. */}
      <div className="hidden lg:flex items-center gap-2">
        {visible.map((i) => (
          <Button key={i.key} size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid={i.testId} onClick={i.onClick}>
            {i.icon}{i.label}
          </Button>
        ))}
        <ChangePasscodeDialog onChanged={onChangedPasscode} buttonClassName="text-white hover:bg-white/15" open={passcodeOpen} onOpenChange={setPasscodeOpen} />
        {showSecurity && <TwoFactorAuthDialog open={securityOpen} onOpenChange={setSecurityOpen} />}
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid={logoutTestId} onClick={exit}>
          <LogOut className="w-4 h-4 mr-1" /> Exit
        </Button>
      </div>

      {/* Mobile / tablet: menu keeps every item accessible, Exit included. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="lg:hidden text-white hover:bg-white/15 px-2" aria-label="Open menu" data-testid="console-menu-btn">
            <Menu className="w-5 h-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {menuLabel && <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>}
          {visible.map((i) => (
            <DropdownMenuItem key={i.key} data-testid={i.menuTestId} onSelect={() => { setMenuOpen(false); i.onClick(); }}>
              {i.icon}{i.label}
            </DropdownMenuItem>
          ))}
          {visible.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem data-testid="menu-change-passcode" onSelect={() => { setMenuOpen(false); setPasscodeOpen(true); }}>
            <KeyRound className="w-4 h-4" /> Change passcode
          </DropdownMenuItem>
          {showSecurity && (
            <DropdownMenuItem data-testid="menu-security" onSelect={() => { setMenuOpen(false); setSecurityOpen(true); }}>
              <ShieldCheck className="w-4 h-4" /> Security
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="menu-logout-btn" onSelect={exit} className="text-destructive focus:text-destructive">
            <LogOut className="w-4 h-4" /> Exit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
