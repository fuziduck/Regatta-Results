import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Anchor, ShieldCheck, Radio, ArrowLeft, Building2, Globe } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clubs, setClubs] = useState([]);
  const [clubId, setClubId] = useState("");
  const [role, setRole] = useState("officer");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getClubs().then((cs) => {
      setClubs(cs || []);
      const fromUrl = (cs || []).find((c) => c.slug === searchParams.get("club"));
      setClubId((fromUrl || (cs || [])[0])?.id || "");
    }).catch(() => {});
  }, [searchParams]);

  const selectedClub = clubs.find((c) => c.id === clubId);

  const isWebmaster = role === "webmaster";
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await login(role, pin, isWebmaster ? null : clubId);
      if (isWebmaster) {
        toast.success("Signed in as Webmaster");
        navigate("/webmaster");
      } else {
        toast.success(`Signed in to ${r.club_name} as ${r.role === "admin" ? "Race Admin" : "Race Officer"}`);
        navigate(r.role === "admin" ? "/admin" : "/officer");
      }
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
              <p className="text-sm text-muted-foreground">{selectedClub ? selectedClub.name : "Officials access"}</p>
            </div>
          </div>

          {!isWebmaster ? (
            <div className="mt-6 space-y-2">
              <Label htmlFor="club">Club</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <select
                  id="club"
                  data-testid="club-select"
                  value={clubId}
                  onChange={(e) => setClubId(e.target.value)}
                  className="w-full h-12 pl-9 pr-3 rounded-lg border border-input bg-background text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {!clubs.length && <option value="">No clubs available</option>}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Globe className="w-4 h-4 inline-block mr-1.5 text-ocean" />
              Webmaster access covers <strong>all clubs</strong> — no club needed here.
            </div>
          )}

          <Tabs value={role} onValueChange={setRole} className="mt-6">
            <TabsList className="grid grid-cols-3 w-full h-auto">
              <TabsTrigger value="officer" data-testid="role-officer-tab" className="py-2.5 gap-1 px-1"><Radio className="w-4 h-4 hidden sm:block" /><span className="text-xs sm:text-sm">Race Officer</span></TabsTrigger>
              <TabsTrigger value="admin" data-testid="role-admin-tab" className="py-2.5 gap-1 px-1"><ShieldCheck className="w-4 h-4 hidden sm:block" /><span className="text-xs sm:text-sm">Race Admin</span></TabsTrigger>
              <TabsTrigger value="webmaster" data-testid="role-webmaster-tab" className="py-2.5 gap-1 px-1"><Globe className="w-4 h-4 hidden sm:block" /><span className="text-xs sm:text-sm">Webmaster</span></TabsTrigger>
            </TabsList>
            <TabsContent value="officer" className="mt-2 text-sm text-muted-foreground">Run race day, record finishes and publish results.</TabsContent>
            <TabsContent value="admin" className="mt-2 text-sm text-muted-foreground">Manage boats, classes, series and historic results.</TabsContent>
            <TabsContent value="webmaster" className="mt-2 text-sm text-muted-foreground">Manage clubs and access every club's officer & admin consoles.</TabsContent>
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
        <p className="mt-6 text-center text-sm text-white/80">SailScore — Connecting sailing, one club at a time.</p>
      </div>
    </div>
  );
}
