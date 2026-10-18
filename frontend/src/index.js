import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { flushDeferredDeletes, installDeferredDeleteFlush } from "@/lib/pending-deletes";

// Apply the saved/system theme before React renders so there is no flash of
// the wrong colour scheme. ThemeContext reads the same sources.
{
  const stored = window.localStorage.getItem("sailscore-theme");
  const dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) document.documentElement.classList.add("dark");
}

// A delete confirmed just before a reload/close is replayed here, and again as
// the page goes away, so a confirmed delete can never be lost with the tab.
installDeferredDeleteFlush();
flushDeferredDeletes();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
