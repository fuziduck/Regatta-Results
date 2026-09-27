import { useState } from "react";
import { BookOpen, LifeBuoy, ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getHelpTopic } from "@/lib/helpContent";

export default function HelpSidebar({ buttonClassName = "", buttonLabel = "Help", iconOnly = false, open: controlledOpen, onOpenChange, showTrigger = true }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = (nextOpen) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const topic = getHelpTopic(window.location.pathname);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {showTrigger && (
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size={iconOnly ? "icon" : "sm"} aria-label="Open help and guides" title="Help" data-testid="help-sidebar-trigger" className={`gap-1.5 ${buttonClassName}`}>
            <LifeBuoy className="h-4 w-4" />{iconOnly ? null : buttonLabel}
          </Button>
        </SheetTrigger>
      )}

      <SheetContent side="right" className="flex w-[min(92vw,28rem)] flex-col overflow-hidden p-0 sm:max-w-md" data-testid="help-sidebar">
        <SheetHeader className="border-b border-border px-5 py-5 pr-14 text-left">
          <div className="mb-1 flex items-center gap-2 text-ocean"><BookOpen className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-widest">SailScore help</span></div>
          <SheetTitle className="font-heading text-2xl uppercase tracking-tight">{topic.title}</SheetTitle>
          <SheetDescription>{topic.intro}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
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
            <a href="/help/quick-start/officer" onClick={() => handleOpenChange(false)} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50">
              <ListChecks className="h-4 w-4 text-ocean" /> Race Officer quick start
            </a>
            <a href="/help/quick-start/admin" onClick={() => handleOpenChange(false)} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50">
              <ListChecks className="h-4 w-4 text-ocean" /> Race Admin quick start
            </a>
            <a href="/faq" onClick={() => handleOpenChange(false)} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-ocean/50 hover:bg-muted/50">
              <Search className="h-4 w-4 text-ocean" /> Browse all FAQs
            </a>
          </nav>
        </div>
        <div className="border-t border-border px-5 py-3">
          <a href="/help" onClick={() => handleOpenChange(false)} className="text-sm font-semibold text-ocean hover:underline">Help home</a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
