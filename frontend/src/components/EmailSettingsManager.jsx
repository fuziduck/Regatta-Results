import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Send, Save, Loader2, Info } from "lucide-react";

export default function EmailSettingsManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_password: "",
    mail_from: "",
  });
  const [testTo, setTestTo] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  const [usingEnv, setUsingEnv] = useState(false);

  useEffect(() => {
    api.getEmailSettings()
      .then((s) => {
        setForm({
          smtp_host: s.smtp_host || "",
          smtp_port: s.smtp_port || 587,
          smtp_user: s.smtp_user || "",
          smtp_password: "",
          mail_from: s.mail_from || "",
        });
        setPasswordSet(s.password_set);
        setUsingEnv(s.using_env);
      })
      .catch(() => toast.error("Could not load email settings"))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!form.smtp_host.trim()) {
      if (!window.confirm("Clear the email settings? Password-reset emails will be disabled until you reconfigure them.")) return;
    }
    setSaving(true);
    try {
      const payload = {
        smtp_host: form.smtp_host.trim(),
        smtp_port: Number(form.smtp_port) || 587,
        smtp_user: form.smtp_user.trim(),
        mail_from: form.mail_from.trim() || null,
      };
      if (form.smtp_password) payload.smtp_password = form.smtp_password;
      const res = await api.updateEmailSettings(payload);
      setPasswordSet(!!form.smtp_password || passwordSet);
      setForm((f) => ({ ...f, smtp_password: "" }));
      toast.success(res.configured ? "Email settings saved" : "Email settings cleared");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save email settings");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!testTo.trim()) return toast.error("Enter an email address to send the test to");
    setTesting(true);
    try {
      const res = await api.testEmail(testTo.trim());
      toast.success(res.message || "Test email sent");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Test email failed to send");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-10 text-center">Loading email settings…</div>;
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-3xl uppercase tracking-tighter mb-1">Email settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure the SMTP server used for passcode-reset emails. Stored securely — the password is encrypted and
          never shown again.
        </p>
      </div>

      {usingEnv && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 p-3.5 text-sm text-amber-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Currently using SMTP values from the server environment. Saving settings here overrides them.</span>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="grid sm:grid-cols-[1fr_120px] gap-3">
          <div className="space-y-1.5">
            <Label>SMTP host</Label>
            <Input
              data-testid="smtp-host-input"
              value={form.smtp_host}
              onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
              placeholder="smtp.mail.me.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Port</Label>
            <Input
              data-testid="smtp-port-input"
              type="number"
              value={form.smtp_port}
              onChange={(e) => setForm({ ...form, smtp_port: e.target.value })}
              placeholder="587"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input
            data-testid="smtp-user-input"
            value={form.smtp_user}
            onChange={(e) => setForm({ ...form, smtp_user: e.target.value })}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Password</Label>
          <Input
            data-testid="smtp-password-input"
            type="password"
            value={form.smtp_password}
            onChange={(e) => setForm({ ...form, smtp_password: e.target.value })}
            placeholder={passwordSet ? "••••••••  (leave blank to keep current)" : "App-specific password"}
          />
        </div>
        <div className="space-y-1.5">
          <Label>From address</Label>
          <Input
            data-testid="smtp-from-input"
            value={form.mail_from}
            onChange={(e) => setForm({ ...form, mail_from: e.target.value })}
            placeholder="you@example.com"
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button data-testid="save-email-settings-btn" onClick={save} disabled={saving} className="bg-ocean hover:bg-ocean-dark">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />} Save settings
          </Button>
          {form.smtp_host.trim() && (
            <span className="text-xs text-muted-foreground">
              <Mail className="w-3.5 h-3.5 inline mr-1" />
              {passwordSet ? "Password stored" : "No password set yet"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-heading uppercase tracking-tight text-sm mb-1 flex items-center gap-2">
          <Send className="w-4 h-4 text-ocean" /> Send a test email
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Verify the settings work before relying on them for password resets.
        </p>
        <div className="flex gap-2">
          <Input
            data-testid="test-email-input"
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            className="flex-1"
          />
          <Button data-testid="send-test-email-btn" variant="outline" onClick={test} disabled={testing || !form.smtp_host.trim()}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />} Send
          </Button>
        </div>
      </div>
    </div>
  );
}
