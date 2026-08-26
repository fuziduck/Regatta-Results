import TwoFactorAuth from "@/components/TwoFactorAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck } from "lucide-react";

// The club staff (officer/admin) entry point for two-factor authentication:
// a "Security" button in the console top bar that opens the shared 2FA panel
// in a dialog. Controlled like ChangePasscodeDialog so the mobile menu can
// open the same instance.
export default function TwoFactorAuthDialog({ open, onOpenChange, buttonClassName = "" }) {
  return (
    <>
      <Button size="sm" variant="ghost" className={`text-white hover:bg-white/15 ${buttonClassName}`} data-testid="security-btn" onClick={() => onOpenChange(true)}>
        <ShieldCheck className="w-4 h-4 mr-1" /> Security
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="security-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Security</DialogTitle></DialogHeader>
          <TwoFactorAuth />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
