import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Anchor, ShieldCheck, Radio, ArrowLeft } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState("officer");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await login(role, pin);
      toast.success(`Signed in as ${r === "admin" ? "Race Admin" : "Race Officer"}`);
      navigate(r === "admin" ? "/admin" : "/officer");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-ocean-dark">
      <img
        src="https://images.unsplash.com/photo-1512602110-67198e50f815?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTV8MHwxfHNlYXJjaHwyfHx5YWNodCUyMGNsdWIlMjBtYXJpbmF8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85"
        alt="marina"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 hero-overlay" />
      <div className="relative w-full max-w-md">
        <Link to="/" data-testid="back-to-results-link" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 text-sm font-semibold transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to results
        </Link>
        <div className="bg-card rounded-2xl shadow-2xl p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-ocean grid place-items-center">
              <Anchor className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl uppercase tracking-tight leading-none text-foreground">Club Login</h1>
              <p className="text-sm text-muted-foreground">Officials access</p>
            </div>
          </div>

          <Tabs value={role} onValueChange={setRole} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full h-auto">
              <TabsTrigger value="officer" data-testid="role-officer-tab" className="py-2.5 gap-2"><Radio className="w-4 h-4" /> Race Officer</TabsTrigger>
              <TabsTrigger value="admin" data-testid="role-admin-tab" className="py-2.5 gap-2"><ShieldCheck className="w-4 h-4" /> Race Admin</TabsTrigger>
            </TabsList>
            <TabsContent value="officer" className="mt-2 text-sm text-muted-foreground">Run race day, record finishes and publish results.</TabsContent>
            <TabsContent value="admin" className="mt-2 text-sm text-muted-foreground">Manage boats, classes, series and historic results.</TabsContent>
          </Tabs>

          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pin">Passcode</Label>
              <Input
                id="pin"
                type="password"
                data-testid="pin-input"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter role passcode"
                autoFocus
                className="h-12 text-lg tabular"
              />
            </div>
            <Button type="submit" data-testid="login-submit-btn" disabled={loading || !pin} className="w-full h-12 text-base bg-ocean hover:bg-ocean-dark transition-transform active:scale-[0.98]">
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
