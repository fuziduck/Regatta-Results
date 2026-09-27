import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CheckCircle2, LifeBuoy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import HeaderMenu from "@/components/HeaderMenu";
import Logo from "@/components/Logo";
import HelpSidebar from "@/components/HelpSidebar";
import { FAQS, QUICK_STARTS } from "@/lib/helpContent";

function HelpHeader({ title }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <HeaderMenu title={`SailScore · ${title}`} />
          <Link to="/"><Logo className="h-11 w-auto" /></Link>
          <span className="hidden font-heading text-lg uppercase tracking-tight sm:block">Help centre</span>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/help" className="hidden sm:block"><Button variant="ghost" size="sm">Help home</Button></Link>
          <Link to="/faq" className="hidden sm:block"><Button variant="ghost" size="sm">FAQs</Button></Link>
          <HelpSidebar />
        </div>
      </div>
    </header>
  );
}

function QuickStart({ role }) {
  const guide = QUICK_STARTS[role];
  const [done, setDone] = useState({});
  const completeCount = Object.values(done).filter(Boolean).length;
  return (
    <>
      <HelpHeader title={guide.title} />
      <main className="mx-auto max-w-4xl px-4 py-9 sm:py-12">
        <Link to="/help" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-ocean hover:underline"><ArrowLeft className="h-4 w-4" /> All help</Link>
        <div className="mb-7">
          <div className="mb-2 inline-flex items-center gap-2 text-ocean"><CheckCircle2 className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-widest">Quick start checklist</span></div>
          <h1 className="text-3xl uppercase tracking-tighter sm:text-4xl">{guide.title}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{guide.intro}</p>
        </div>
        <div className="mb-5 rounded-xl border border-ocean/20 bg-ocean/5 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">Your progress</span><span className="tabular-nums text-muted-foreground">{completeCount} of {guide.steps.length} complete</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ocean/10"><div className="h-full rounded-full bg-ocean transition-all" style={{ width: `${completeCount / guide.steps.length * 100}%` }} /></div>
        </div>
        <ol className="space-y-3">
          {guide.steps.map(([title, description], index) => (
            <li key={title} className={`rounded-xl border bg-card p-4 transition-colors ${done[index] ? "border-emerald-500/40" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full font-heading ${done[index] ? "bg-emerald-600 text-white" : "bg-ocean/10 text-ocean"}`}>{done[index] ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>
                <div className="min-w-0 flex-1"><h2 className="font-heading text-lg uppercase tracking-tight">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div>
                <Button type="button" size="sm" variant={done[index] ? "secondary" : "outline"} aria-pressed={!!done[index]} onClick={() => setDone((current) => ({ ...current, [index]: !current[index] }))} data-testid={`quick-start-step-${index}`}>{done[index] ? "Done" : "Mark done"}</Button>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-muted-foreground">Need more detail? Open the <Link to="/faq" className="font-semibold text-ocean hover:underline">full FAQ</Link>, or use Help in the console for guidance about the current page.</p>
      </main>
    </>
  );
}

function FaqPage() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return FAQS.filter((item) => !term || `${item.category} ${item.question} ${item.answer}`.toLocaleLowerCase().includes(term));
  }, [query]);
  const grouped = useMemo(() => filtered.reduce((groups, item) => {
    (groups[item.category] ||= []).push(item);
    return groups;
  }, {}), [filtered]);
  return (
    <>
      <HelpHeader title="Frequently asked questions" />
      <main className="mx-auto max-w-4xl px-4 py-9 sm:py-12">
        <Link to="/help" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-ocean hover:underline"><ArrowLeft className="h-4 w-4" /> Help home</Link>
        <div className="mb-6">
          <div className="mb-2 inline-flex items-center gap-2 text-ocean"><Search className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-widest">Help centre</span></div>
          <h1 className="text-3xl uppercase tracking-tighter sm:text-4xl">Frequently asked questions</h1>
          <p className="mt-2 text-muted-foreground">Search practical answers about results, race day, accounts and club administration.</p>
        </div>
        <label htmlFor="faq-search" className="sr-only">Search frequently asked questions</label>
        <div className="relative mb-7"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="faq-search" data-testid="faq-search" type="search" placeholder="Search questions, scoring, notices…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
        {Object.entries(grouped).length ? Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="mb-7" aria-label={category}>
            <h2 className="mb-1 font-heading text-xl uppercase tracking-tight text-ocean">{category}</h2>
            <Accordion type="multiple" className="rounded-xl border border-border bg-card px-4">
              {items.map((item, index) => <AccordionItem key={item.question} value={`${category}-${index}`}><AccordionTrigger data-testid="faq-question" className="text-left">{item.question}</AccordionTrigger><AccordionContent className="leading-relaxed text-muted-foreground">{item.answer}</AccordionContent></AccordionItem>)}
            </Accordion>
          </section>
        )) : <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No matching questions. Try a different search term.</div>}
        <p className="mt-8 text-sm text-muted-foreground">Still stuck? Contact your club race officer for scoring, or your club administrator for account and setup questions.</p>
      </main>
    </>
  );
}

export default function Help() {
  const { guide } = useParams();
  const { pathname } = useLocation();
  if (guide === "officer" || guide === "admin") return <QuickStart key={guide} role={guide} />;
  if (pathname === "/faq") return <FaqPage />;
  return (
    <>
      <HelpHeader title="Help and guides" />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-2 text-ocean"><LifeBuoy className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-widest">SailScore help centre</span></div>
          <h1 className="text-3xl uppercase tracking-tighter sm:text-5xl">Find your way around</h1>
          <p className="mt-3 text-muted-foreground">Page-by-page instructions, practical answers and role-specific checklists for running a smooth race day and maintaining your club.</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Link to="/faq" className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-ocean/50 hover:shadow-lg" data-testid="help-faq-card"><Search className="mb-4 h-6 w-6 text-ocean" /><h2 className="font-heading text-xl uppercase">Full FAQ</h2><p className="mt-2 text-sm text-muted-foreground">Search answers about finding results, scoring, subscriptions, security and troubleshooting.</p><span className="mt-4 inline-block text-sm font-bold text-ocean group-hover:underline">Browse questions →</span></Link>
          <Link to="/help/quick-start/officer" className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-ocean/50 hover:shadow-lg" data-testid="help-officer-card"><CheckCircle2 className="mb-4 h-6 w-6 text-ocean" /><h2 className="font-heading text-xl uppercase">Race Officer</h2><p className="mt-2 text-sm text-muted-foreground">A race-day checklist from opening the schedule to publishing checked results.</p><span className="mt-4 inline-block text-sm font-bold text-ocean group-hover:underline">Start officer guide →</span></Link>
          <Link to="/help/quick-start/admin" className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-ocean/50 hover:shadow-lg" data-testid="help-admin-card"><BookOpen className="mb-4 h-6 w-6 text-ocean" /><h2 className="font-heading text-xl uppercase">Race Admin</h2><p className="mt-2 text-sm text-muted-foreground">Set up fleets, boats, season scoring, notices and account access in the right order.</p><span className="mt-4 inline-block text-sm font-bold text-ocean group-hover:underline">Start admin guide →</span></Link>
        </div>
        <section className="mt-10 rounded-2xl border border-ocean/20 bg-ocean/5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-heading text-2xl uppercase tracking-tight">Need help on a specific page?</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">Open the Help button in a page header or console. The side panel explains the current page's options and controls.</p></div><HelpSidebar buttonClassName="bg-ocean text-white hover:bg-ocean/90" buttonLabel="Try contextual help" /></div>
        </section>
      </main>
    </>
  );
}
