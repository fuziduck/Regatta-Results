import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Megaphone, Plus, Pencil, Trash2, ImagePlus, ExternalLink, X } from "lucide-react";

const blank = { name: "", link_url: "", active: true, format: "auto" };

// Per-shape image slots. The card picks the image that matches the box shape,
// so an advert can carry a different image for each of the three shapes.
const SHAPES = [
  { key: "landscape", label: "Landscape", hint: "Wide box", ratio: "4 / 3", box: "w-7 h-4" },
  { key: "portrait", label: "Portrait", hint: "Tall box", ratio: "3 / 4", box: "w-4 h-7" },
  { key: "square", label: "Square", hint: "Equal sides", ratio: "1 / 1", box: "w-5 h-5" },
];

// Display shapes for the card box. \"auto\" fits the image's own ratio; the
// named shapes standardise the box to a fixed ratio and pick the matching
// uploaded image.
const FORMATS = [
  { key: "auto", label: "Auto", hint: "Matches the image" },
  { key: "landscape", label: "Landscape", hint: "Wide box" },
  { key: "portrait", label: "Portrait", hint: "Tall box" },
  { key: "square", label: "Square", hint: "Equal sides" },
];
const SHAPE_RATIO = { auto: null, landscape: 4 / 3, portrait: 3 / 4, square: 1 };

// Mirrors the backend's ADVERT_IMAGE_MAX and magic-byte detection so a bad
// file is rejected in the browser before the upload is even attempted.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function _startsWith(bytes, sig) {
  return sig.every((b, i) => bytes[i] === b);
}

async function validateImageFile(file) {
  if (!file || file.size === 0) return "The file is empty";
  if (file.size > MAX_IMAGE_BYTES)
    return `Too large — ${(file.size / 1048576).toFixed(1)} MB (max 2 MB)`;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isPng = _startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg = _startsWith(head, [0xff, 0xd8, 0xff]);
  const isGif = _startsWith(head, [0x47, 0x49, 0x46, 0x38]);
  const isWebp =
    _startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    _startsWith(head.slice(8), [0x57, 0x45, 0x42, 0x50]);
  if (!(isPng || isJpeg || isGif || isWebp))
    return "Not a recognised image — the file must be a PNG, JPEG, GIF or WebP";
  return null;
}

export default function AdvertsManager() {
  const [adverts, setAdverts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState({}); // { landscape?: File, portrait?: File, square?: File }
  const [errors, setErrors] = useState({}); // { shape?: validation error string }

  const load = useCallback(() => api.getAdvertsManage().then(setAdverts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setForm(blank); setFiles({}); setErrors({}); setEditing(null); };

  const save = async () => {
    if (!form.name) return toast.error("Give the advert a name");
    const badFile = Object.values(errors).find(Boolean);
    if (badFile) return toast.error(badFile);
    try {
      if (editing) {
        await api.updateAdvert(editing, { name: form.name, link_url: form.link_url, active: form.active, format: form.format });
        if (Object.keys(files).length) await api.uploadAdvertImages(editing, files);
        toast.success("Advert updated");
      } else {
        const fd = new FormData();
        fd.append("name", form.name);
        fd.append("link_url", form.link_url || "");
        fd.append("active", String(form.active));
        fd.append("format", form.format);
        Object.entries(files).forEach(([shape, file]) => {
          if (file) fd.append(`file_${shape}`, file);
        });
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
    setFiles({});
    setOpen(true);
  };

  // Current image for a shape: the uploaded file (preview), else the stored
  // image for that shape (or the legacy single image as landscape).
  const shapeImage = (shape) => {
    if (files[shape]) return URL.createObjectURL(files[shape]);
    const a = adverts.find((x) => x.id === editing);
    if (!a) return null;
    const imgs = a.images || {};
    return imgs[shape] || (shape === "landscape" ? a.image : null) || null;
  };

  const setShapeFile = async (shape, file) => {
    setErrors((prev) => { const next = { ...prev }; delete next[shape]; return next; });
    if (!file) {
      setFiles((prev) => { const next = { ...prev }; delete next[shape]; return next; });
      return;
    }
    const err = await validateImageFile(file);
    if (err) {
      setErrors((prev) => ({ ...prev, [shape]: err }));
      return; // never keep a file that the backend would reject
    }
    setFiles((prev) => ({ ...prev, [shape]: file }));
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
          <DialogContent className="max-w-lg">
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
                <Label>Images</Label>
                <p className="text-xs text-muted-foreground">
                  Upload one image per shape — the card uses the one matching its box. The full image always fits.
                </p>
                <div className="grid grid-cols-3 gap-2" data-testid="advert-image-slots">
                  {SHAPES.map((s) => {
                    const current = shapeImage(s.key);
                    return (
                      <div key={s.key} className="rounded-lg border border-border p-2 flex flex-col gap-2" data-testid={`advert-slot-${s.key}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                            <span className={`block rounded-sm border-2 border-ocean ${s.box}`} />
                            {s.label}
                          </span>
                          {current && !files[s.key] && (
                            <button type="button" data-testid={`advert-clear-${s.key}`}
                              onClick={() => { /* keep stored image; replace via picker below */ }}
                              className="hidden" />
                          )}
                        </div>
                        <div className="rounded-md bg-muted/50 grid place-items-center overflow-hidden"
                          style={{ aspectRatio: SHAPE_RATIO[s.key] || undefined, minHeight: 56 }}>
                          {current ? (
                            <img src={current} alt={`${s.label} preview`} className="max-w-full max-h-full object-contain" />
                          ) : (
                            <span className="text-[10px] text-muted-foreground px-1 text-center">No image</span>
                          )}
                        </div>
                        <label className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed p-2 cursor-pointer transition-colors ${errors[s.key] ? "border-destructive/60 bg-destructive/5" : "border-border hover:border-ocean/50"}`}>
                          <ImagePlus className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className={`text-xs ${errors[s.key] ? "text-destructive" : "text-muted-foreground"}`}>
                            {files[s.key] ? files[s.key].name : current ? "Replace" : "Upload"}
                          </span>
                          <input type="file" accept="image/*" className="hidden" data-testid={`advert-file-${s.key}`}
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              e.target.value = ""; // allow re-picking the same file after a fix
                              setShapeFile(s.key, f);
                            }} />
                        </label>
                        {files[s.key] && !errors[s.key] && (
                          <span className="text-[10px] text-muted-foreground">{(files[s.key].size / 1024).toFixed(0)} KB</span>
                        )}
                        {errors[s.key] && (
                          <p className="text-[11px] text-destructive leading-tight">{errors[s.key]}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(files.landscape || files.portrait || files.square) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <X className="w-3 h-3" /> New uploads replace the shape's current image on save.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Card shape</Label>
                <div className="grid grid-cols-4 gap-2" data-testid="advert-shape-picker">
                  {FORMATS.map((s) => {
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
                <p className="text-xs text-muted-foreground">The card box shape on the public page. Auto fits the image's own ratio.</p>
              </div>

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
          {adverts.map((a) => {
            const imgs = a.images || {};
            const preview = imgs.landscape || imgs.portrait || imgs.square || a.image;
            return (
              <div key={a.id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
                {preview ? (
                  <img src={preview} alt={a.name} className="w-24 h-16 rounded-lg object-cover shrink-0 border border-border/60" />
                ) : (
                  <div className="w-24 h-16 rounded-lg bg-muted grid place-items-center text-muted-foreground text-xs shrink-0">No image</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-heading uppercase tracking-tight leading-tight break-words">{a.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {a.active ? <span className="text-emerald-600 font-semibold">Active</span> : <span className="text-muted-foreground">Inactive</span>}
                    <span className="uppercase tracking-wide rounded-full border border-border px-2 py-0.5">{a.format || "auto"}</span>
                    <span className="text-muted-foreground/80">
                      {Object.keys(imgs).length
                        ? `${Object.keys(imgs).length} image${Object.keys(imgs).length > 1 ? "s" : ""}`
                        : a.image ? "1 image" : "no image"}
                    </span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
