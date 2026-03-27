"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface LineageAutocompleteProps {
  suggestions: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
}

export default function LineageAutocomplete({
  suggestions,
  onSelect,
  placeholder = "Search lineage..."
}: LineageAutocompleteProps) {
  const [value, setValue] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>(
    { top: 0, left: 0, width: 0 }
  );

  const normalize = (s: string) =>
    s.toLowerCase().replace(/(^|\b)([dpcofgs])_/, "$1$2__");

  const filtered = useMemo(
    () =>
      suggestions.filter((opt) => normalize(opt).includes(normalize(value))),
    [value, suggestions]
  );

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuPos({
        top: Math.round(rect.bottom + 4),
        left: Math.round(rect.left),
        width: Math.round(rect.width)
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inInput = !!inputRef.current && inputRef.current.contains(target);
      const inMenu = !!menuRef.current && menuRef.current.contains(target);
      if (!inInput && !inMenu) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="lineage-autocomplete relative">
      <input
        ref={inputRef}
        type="text"
        className="border border-gray-400 rounded w-full text-xs h-7 px-2 text-gray-900 placeholder:text-gray-500 bg-white"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSelect(value);
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="viz-opaque-menu fixed z-[9999] bg-white border border-gray-300 rounded-md shadow-md p-1 text-gray-900"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: Math.max(180, menuPos.width)
            }}
          >
            <div className="max-h-64 overflow-auto">
              {filtered.slice(0, 200).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="w-full text-left text-xs px-2 py-1 rounded text-gray-900 hover:bg-gray-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setValue(opt);
                    onSelect(opt);
                    setOpen(false);
                  }}
                >
                  {opt}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-xs text-gray-600 px-2 py-1">No matches</div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
