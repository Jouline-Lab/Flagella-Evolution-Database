"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme-mode";

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem(STORAGE_KEY, mode);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initialMode: ThemeMode = stored === "dark" ? "dark" : "light";
    setMode(initialMode);
    applyTheme(initialMode);
  }, []);

  const toggleMode = () => {
    const nextMode: ThemeMode = mode === "light" ? "dark" : "light";
    setMode(nextMode);
    applyTheme(nextMode);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleMode}
      aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {mode === "light" ? (
          <svg viewBox="0 0 24 24" focusable="false">
            <path
              d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" focusable="false">
            <circle
              cx="12"
              cy="12"
              r="4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M12 2.5V5.1M12 18.9v2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
