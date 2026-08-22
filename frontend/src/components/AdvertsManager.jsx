import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Megaphone, Plus, Pencil, Trash2, ImagePlus, ExternalLink } from "lucide-react";

const blank = { name: "", link_url: "", active: true, format: "auto" };

// Display shapes for the card box. "auto" fits the uploaded image's own
// ratio; the named shapes standardise the box to a fixed ratio.
const SHAPES = [
  { key: "auto", label: "Auto", hint: "Matches the image" },
  { key: "landscape", label: "Landscape", hint: "Wide box" },
  { key: "portrait", label: "Portrait", hint: "Tall box" },
  { key: "square", label: "Square", hint: "Equal sides" },
];
// Preview aspect ratios for the shape selector / image preview.
const SHAPE_RATIO = { auto: null, landscape: 4 / 3, portrait: 3 / 4, square: 1 };

export default function AdvertsManager() {
  const [adverts, setAdverts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);

  const load = useCallback(() => api.getAdvertsManage().then(setAdverts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setForm(blank); setFile(null); setEditing(null); };

  const save = async () => {
    if (!form.name) return toast.error("Give the advert a name");
    try {
      if (editing) {
        await api.updateAdvert(editing, { name: form.name, link_url: form.link_url, active: form.active, format: form.format });
        if (file) await api.uploadAdvertImage(editing, file);
        toast.success("Advert updated");
      } else {
        const fd = new FormData();
        fd.append("name", form.name);
        fd.append("link_url", form.link_url || "");
        fd.append("active", String(form.active));
        fd.append("format", form.format);
        if (file) fd.append("file", file);
        await api.createAdvert(fd);
        toast.success("Advert added");
      }
      setOpen(false); reset(); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save advert");
    }
  };

  const del = async (a) => {
    if (!window.confirm(`Delete advert "${a.name}"?`)) return;
    await api.deleteAdvert(a.id);
    toast.success("Advert deleted"); load();
  };

  const edit = (a) => {
    setEditing(a.id);
    setForm({ name: a.name, link_url: a.link_url || "", active: a.active !== false, format: a.format || "auto" });
    setFile(null);
    setOpen(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl uppercase tracking-tighter mb-1">Advertising</h1>
          <p className="text-muted-foreground text-sm">
            Add or remove adverts shown on the public pages. They rotate — up to 10 per page load.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-ocean hover:bg-ocean-dark h-12 px-5" data-testid="add-advert-btn"><Plus className="w-5 h-5" /> Add advert</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} advert</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input data-testid="advert-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Medway Marina" />
              </div>
              <div className="space-y-1.5">
                <Label>Link URL (optional)</Label>
                <Input data-testid="advert-link-input" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://…" />
              </div>
              <div className="space-y-1.5">
                <Label>Image</Label>
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 cursor-pointer hover:border-ocean/50 transition-colors">
                  <ImagePlus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {file ? file.name : editing ? "Replace image…" : "Choose image (PNG/JPG/WebP, ≤2 MB)"}
                  </span>
                  <input type="file" accept="image/*" className="hidden" data-testid="advert-file-input"
                    onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="space-y-1.5">
                <Label>Image shape</Label>
                <div className="grid grid-cols-4 gap-2" data-testid="advert-shape-picker">
                  {SHAPES.map((s) => {
                    const selected = form.format === s.key;
                    return (
                      <button key={s.key} type="button"
                        data-testid={`advert-shape-${s.key}`}
                        onClick={() => setForm({ ...form, format: s.key })}
                        className={`rounded-lg border p-2 flex flex-col items-center gap-1.5 transition-colors ${selected ? "border-ocean bg-ocean/5 text-ocean" : "border-border hover:border-ocean/40"}`}>
                        <span className={`block rounded-sm border-2 ${selected ? "border-ocean" : "border-muted-foreground/60"} ${
                          s.key === "auto" ? "w-7 h-4" : s.key === "landscape" ? "w-7 h-4" : s.key === "portrait" ? "w-4 h-7" : "w-5 h-5"
                        }`} />
                        <span className="text-xs font-semibold leading-none">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Auto fits the uploaded image's own shape — the full image always fits. Pick a shape to standardise the card box.</p>
              </div>
              {(file || (editing && adverts.find((a) => a.id === editing)?.image)) && (
                <div className="space-y-1.5">
                  <Label>Preview</Label>
                  <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-center" style={{ aspectRatio: SHAPE_RATIO[form.format] || undefined }}>
                    <img src={file ? URL.createObjectURL(file) : adverts.find((a) => a.id === editing)?.image}
                      alt="Advert preview" className="max-w-full max-h-full object-contain" />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <div className="font-semibold text-sm">Active</div>
                  <div className="text-xs text-muted-foreground">Shown on the public pages</div>
                </div>
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="advert-active-switch" />
              </div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-advert-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {adverts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-60" />
          <p>No adverts yet — add the first one to appear on the public pages.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="adverts-list">
          {adverts.map((a) => (
            <div key={a.id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
              {a.image ? (
                <img src={a.image} alt={a.name} className="w-24 h-16 rounded-lg object-cover shrink-0 border border-border/60" />
              ) : (
                <div className="w-24 h-16 rounded-lg bg-muted grid place-items-center text-muted-foreground text-xs shrink-0">No image</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-heading uppercase tracking-tight leading-tight break-words">{a.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {a.active ? <span className="text-emerald-600 font-semibold">Active</span> : <span className="text-muted-foreground">Inactive</span>}
                  <span className="uppercase tracking-wide rounded-full border border-border px-2 py-0.5">{a.format || "auto"}</span>
                  {a.link_url && (
                    <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-ocean hover:underline truncate">
                      <ExternalLink className="w-3 h-3" /> {a.link_url}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" data-testid={`edit-advert-${a.id}`} onClick={() => edit(a)}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-advert-${a.id}`} onClick={() => del(a)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
