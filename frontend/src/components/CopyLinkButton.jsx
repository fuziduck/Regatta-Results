import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Copy a shareable permalink to the clipboard so it can be pasted into any
// browser/message. Unlike the page-level Share button (native share sheet),
// this always produces the exact URL string for the results currently shown.
export default function CopyLinkButton({ url, className = "", label = "Share", copiedLabel = "Copied" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    toast.success("Link copied — paste it anywhere to share these results.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" data-testid="share-results-link"
      className={`gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0 ${className}`}
      title="Copy a link to these results" aria-label="Copy a link to these results"
      onClick={copy}>
      {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
