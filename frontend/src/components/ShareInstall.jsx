import { useState } from "react";
import { Share2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

// Share the current page (Web Share API with a copy-link fallback) and explain
// how to install SailScore on the phone's home screen (iOS/Android).
export default function ShareInstall({ title, text }) {
  const [open, setOpen] = useState(false);

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

  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="share-page-btn" aria-label="Share this page" title="Share this page" onClick={share}>
        <Share2 className="w-4 h-4" /> <span className="hidden md:inline">Share</span>
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="install-app-btn" aria-label="Install as an app" title="Install as an app" onClick={() => setOpen(true)}>
        <Smartphone className="w-4 h-4" /> <span className="hidden md:inline">Install</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Got it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
