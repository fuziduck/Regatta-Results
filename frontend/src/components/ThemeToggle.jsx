import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";

// `light` renders the toggle for use on dark/navy headers (white icon + hover).
export default function ThemeToggle({ className = "", light = false }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      data-testid="theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
      className={`px-2 ${light ? "text-white hover:bg-white/15" : "text-muted-foreground hover:text-foreground"} ${className}`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
