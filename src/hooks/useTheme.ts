import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme") as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let globalTheme: Theme = getInitial();
let listeners: Array<(t: Theme) => void> = [];

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(globalTheme);

  useEffect(() => {
    // Align with the current global theme on mount
    setTheme(globalTheme);
    if (typeof window !== "undefined") {
      document.documentElement.classList.toggle("dark", globalTheme === "dark");
    }

    const handler = (t: Theme) => setTheme(t);
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);

  const toggle = () => {
    const next: Theme = globalTheme === "dark" ? "light" : "dark";
    globalTheme = next;
    if (typeof window !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("theme", next);
    }
    listeners.forEach((l) => l(next));
  };

  return { theme, toggle };
}
