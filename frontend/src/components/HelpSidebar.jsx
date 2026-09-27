import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, LifeBuoy, ListChecks, Pin, PinOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getHelpTopic, QUICK_STARTS } from "@/lib/helpContent";

const TABLET_QUERY = "(min-width: 700px) and (min-height: 500px)";
const OPEN_HELP_EVENT = "sailscore:open-help";

export function openHelpSidebar() {
  window.dispatchEvent(new Event(OPEN_HELP_EVENT));
}

function OfficerQuickStart({ done, onToggle }) {
  const guide = QUICK_STARTS.officer;
  const completeCount = Object.values(done).filter(Boolean).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5" data-testid="officer-quick-start-panel">
      <div className="mb-4 rounded-xl border border-ocean/20 bg-ocean/5 p-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold">Your progress</span><span className="tabular-nums text-muted-foreground">{completeCount} of {guide.steps.length} complete</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ocean/10"><div className="h-full rounded-full bg-ocean transition-all" style={{ width: `${completeCount / guide.steps.length * 100}%` }} /></div>
      </div>
      <ol className="space-y-3 pb-4">
        {guide.steps.map(([title, description], index) => (
          <li key={title} className={`rounded-xl border bg-card p-3 transition-colors ${done[index] ? "border-emerald-500/40" : "border-border"}`}>
            <div className="flex items-start gap-2.5">
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full font-heading text-sm ${done[index] ? "bg-emerald-600 text-white" : "bg-ocean/10 text-ocean"}`}>{done[index] ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>
              <div className="min-w-0 flex-1"><h3 className="font-heading text-base uppercase tracking-tight">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
              <Button type="button" size="sm" variant={done[index] ? "secondary" : "outline"} aria-pressed={!!done[index]} onClick={() => onToggle(index)} data-testid={`help-officer-step-${index}`} className="shrink-0 px-2">{done[index] ? "Done" : "Mark done"}</Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HelpPanel({ topic, canPin, pinned, officerQuickStart, officerStepsDone, onToggleOfficerStep, onShowContextualHelp, onShowOfficerQuickStart, onTogglePin, onClose }) {
  return (
    <>
      <SheetHeader className="border-b border-border px-5 py-5 pr-14 text-left">
        <div className="mb-1 flex items-center justify-between gap-3 pr-8">
          <div className="flex items-center gap-2 text-ocean"><BookOpen className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-widest">{officerQuickStart ? "Race Officer guide" : "SailScore help"}</span></div>
          {canPin && <Button type="button" size="sm" variant="ghost" aria-label={pinned ? "Unpin help sidebar" : "Pin help sidebar"} aria-pressed={pinned} title={pinned ? "Unpin help sidebar" : "Pin beside results"} data-testid="help-sidebar-pin" onClick={onTogglePin} className="gap-1.5">
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{pinned ? "Unpin" : "Pin"}
          </Button>}
        </div>
        {officerQuickStart ? <>
          <Button type="button" variant="ghost" size="sm" onClick={onShowContextualHelp} className="-ml-3 w-fit gap-1 text-xs" data-testid="help-back-to-contextual"><ArrowLeft className="h-3.5 w-3.5" /> Back to page help</Button>
          <SheetTitle className="font-heading text-2xl uppercase tracking-tight">{QUICK_STARTS.officer.title}</SheetTitle>
          <SheetDescription>{QUICK_STARTS.officer.intro}</SheetDescription>
        </> : <>
          <SheetTitle className="font-heading text-2xl uppercase tracking-tight">{topic.title}</SheetTitle>
          <SheetDescription>{topic.intro}</SheetDescription>
        </>}
      </SheetHeader>
      {officerQuickStart ? <OfficerQuickStart done={officerStepsDone} onToggle={onToggleOfficerStep} /> : <div className="min-h-0 flex-1 overflow-y-auto px-5">
        <h3 className="mt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground">This page</h3>
        <Accordion type="single" collapsible className="mt-1">
          {topic.items.map(([title, description], index) => (
            <AccordionItem value={`${topic.id}-${index}`} key={title} data-testid="help-topic-item">
              <AccordionTrigger className="py-3 text-left text-sm">{title}</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{description}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <h3 className="mt-6 text-xs font-bold uppercase tracking-widest text-muted-foreground">Guides and answers</h3>
        <nav className="my-3 grid gap-2" aria-label="Help guides">
          <button type="button" onClick={onShowOfficerQuickStart} className="flex items-center gap-3 rounded-lg border border-border p-3 text-left text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50" data-testid="help-open-officer-quick-start">
            <ListChecks className="h-4 w-4 text-ocean" /> Race Officer quick start
          </button>
          <a href="/help/quick-start/admin" onClick={onClose} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50">
            <ListChecks className="h-4 w-4 text-ocean" /> Race Admin quick start
          </a>
          <a href="/faq" onClick={onClose} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50">
            <Search className="h-4 w-4 text-ocean" /> Browse all FAQs
          </a>
        </nav>
      </div>}
      <div className="border-t border-border px-5 py-3">
        <a href="/help" onClick={onClose} className="text-sm font-semibold text-ocean hover:underline">Help home</a>
      </div>
    </>
  );
}

function matchesTablet(query) {
  if (typeof window.matchMedia === "function") return window.matchMedia(query)?.matches ?? false;
  return window.innerWidth >= 700 && window.innerHeight >= 500;
}

export default function HelpSidebar({ buttonClassName = "", buttonLabel = "Help", iconOnly = false, open: controlledOpen, onOpenChange, showTrigger = true, pathname = window.location.pathname }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [officerQuickStart, setOfficerQuickStart] = useState(false);
  const [officerStepsDone, setOfficerStepsDone] = useState({});
  const [canPin, setCanPin] = useState(() => matchesTablet(TABLET_QUERY));
  const open = controlledOpen ?? uncontrolledOpen;
  const topic = getHelpTopic(pathname);
  const previousPathname = useRef(pathname);

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) {
      setPinned(false);
      setOfficerQuickStart(false);
    }
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    const media = window.matchMedia?.(TABLET_QUERY);
    const updatePinAvailability = () => {
      const available = media ? media.matches : window.innerWidth >= 700 && window.innerHeight >= 500;
      setCanPin(available);
      if (!available) setPinned(false);
    };
    updatePinAvailability();
    if (media?.addEventListener) media.addEventListener("change", updatePinAvailability);
    else media?.addListener?.(updatePinAvailability);
    return () => {
      if (media?.removeEventListener) media.removeEventListener("change", updatePinAvailability);
      else media?.removeListener?.(updatePinAvailability);
    };
  }, []);

  useEffect(() => {
    if (!open) setPinned(false);
  }, [open]);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      if (!pinned) {
        setUncontrolledOpen(false);
        setOfficerQuickStart(false);
        onOpenChange?.(false);
      }
    }
  }, [pathname, pinned, onOpenChange]);

  useEffect(() => {
    const requestOpen = () => {
      setUncontrolledOpen(true);
      onOpenChange?.(true);
    };
    window.addEventListener(OPEN_HELP_EVENT, requestOpen);
    return () => window.removeEventListener(OPEN_HELP_EVENT, requestOpen);
  }, [onOpenChange]);

  useEffect(() => {
    document.documentElement.classList.toggle("help-sidebar-pinned", canPin && pinned && open);
    return () => document.documentElement.classList.remove("help-sidebar-pinned");
  }, [canPin, pinned, open]);

  const close = () => handleOpenChange(false);
  const content = <HelpPanel
    topic={topic}
    canPin={canPin}
    pinned={pinned}
    officerQuickStart={officerQuickStart}
    officerStepsDone={officerStepsDone}
    onToggleOfficerStep={(index) => setOfficerStepsDone((current) => ({ ...current, [index]: !current[index] }))}
    onShowContextualHelp={() => setOfficerQuickStart(false)}
    onShowOfficerQuickStart={() => setOfficerQuickStart(true)}
    onTogglePin={() => setPinned((value) => !value)}
    onClose={close}
  />;

  return (
    <>
      <Sheet open={open} modal={!pinned} onOpenChange={handleOpenChange}>
        {showTrigger && (
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" size={iconOnly ? "icon" : "sm"} aria-label="Open help and guides" title="Help" data-testid="help-sidebar-trigger" className={`gap-1.5 ${buttonClassName}`}>
              <LifeBuoy className="h-4 w-4" />{iconOnly ? null : buttonLabel}
            </Button>
          </SheetTrigger>
        )}
        <SheetContent
          side="right"
          className={`flex w-[min(92vw,28rem)] flex-col overflow-hidden p-0 sm:max-w-md ${pinned ? "w-[min(38vw,24rem)] sm:max-w-none" : ""}`}
          overlayClassName={pinned ? "hidden" : ""}
          data-testid={pinned ? "help-sidebar-pinned" : "help-sidebar"}
          aria-label={pinned ? "Pinned contextual help" : "Contextual help"}
          aria-modal={pinned ? false : undefined}
          onInteractOutside={pinned ? (event) => event.preventDefault() : undefined}
        >
          {content}
        </SheetContent>
      </Sheet>
    </>
  );
}
