import { useState } from "react";
import { Menu, Share2, Smartphone, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useTheme } from "@/context/ThemeContext";
import { toast } from "sonner";

// Compact burger menu for the public headers. Keeps the interface clean by
// folding the share link, the "install as a web app" guide, and the day/night
// theme toggle into one little dropdown on the left.
export default function HeaderMenu({ title, text, light = false, className = "" }) {
  const [installOpen, setInstallOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: text || title, url });
      } catch (e) {
        if (e.name !== "AbortError") toast.error("Sharing isn't available right now.");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — paste it anywhere to share.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const ghost = light ? "text-white hover:bg-white/15" : "text-muted-foreground hover:text-foreground";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" data-testid="header-menu-btn"
            aria-label="Menu" title="Menu" className={`${ghost} ${className}`}>
            <Menu className="w-5 h-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={share} data-testid="header-menu-share">
            <Share2 className="w-4 h-4" /> Share this page
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setInstallOpen(true)} data-testid="header-menu-install">
            <Smartphone className="w-4 h-4" /> Add to Home Screen
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleTheme} data-testid="header-menu-theme">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {dark ? "Switch to day mode" : "Switch to night mode"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent data-testid="install-help-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Install SailScore as an app</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Add SailScore to your home screen and it opens full-screen like an app — no App Store needed.</p>
            <div>
              <div className="font-semibold text-foreground mb-1">iPhone / iPad (Safari)</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>In Safari's toolbar, tap the <strong>Share</strong> icon (square with an arrow).</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top-right corner.</li>
              </ol>
            </div>
            <div>
              <div className="font-semibold text-foreground mb-1">Android (Chrome)</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Tap the browser menu (three dots ⋮).</li>
                <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
                <li>Confirm — the SailScore icon appears on your home screen.</li>
              </ol>
            </div>
            <p className="text-xs">Results and notices stay up to date whenever you open the app.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setInstallOpen(false)}>Got it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}