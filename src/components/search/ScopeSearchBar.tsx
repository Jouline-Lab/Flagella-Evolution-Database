"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getGeneSuggestionsClient } from "@/lib/browserGenes";
import { getSpeciesSuggestionsClient } from "@/lib/browserSpecies";
import { genePageHref, speciesPageHref } from "@/lib/pageEntityQuery";
import { geneNameToSlug } from "@/lib/flagellaGeneClassification";
import { normalizeSpeciesQuery, speciesNameToSlug } from "@/lib/speciesNaming";

export type ScopeSearchBarVariant = "hero" | "compact";

export type SearchScope = "species" | "gene";

type ScopeSearchBarProps = {
  variant: ScopeSearchBarVariant;
  className?: string;
  onScopeChange?: (scope: SearchScope) => void;
};

function normalizeSpecies(value: string): string {
  return normalizeSpeciesQuery(value);
}

export default function ScopeSearchBar({ variant, className, onScopeChange }: ScopeSearchBarProps) {
  const router = useRouter();
  const c = useMemo(
    () =>
      variant === "hero"
        ? {
            form: "hero-search-form",
            bar: "hero-search-bar",
            scope: "hero-search-scope",
            scopeSizer: "hero-search-scope-sizer",
            scopeTrigger: "hero-search-scope-trigger",
            scopeMenu: "hero-search-scope-menu",
            scopeOption: "hero-search-scope-option",
            inputWrap: "hero-search-input-wrap",
            searchIcon: "hero-search-icon",
            input: "hero-search-input",
            dropdown: "hero-search-dropdown"
          }
        : {
            form: "topbar-search-form",
            bar: "topbar-search-bar",
            scope: "topbar-search-scope",
            scopeSizer: "topbar-search-scope-sizer",
            scopeTrigger: "topbar-search-scope-trigger",
            scopeMenu: "topbar-search-scope-menu",
            scopeOption: "topbar-search-scope-option",
            inputWrap: "topbar-search-input-wrap",
            searchIcon: "topbar-search-icon",
            input: "topbar-search-input",
            dropdown: "topbar-search-dropdown"
          },
    [variant]
  );

  const [scope, setScope] = useState<SearchScope>("species");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ name: string; slug: string }>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopeWrapRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    setQuery("");
    setSuggestions([]);
    setIsOpen(false);
    setScopeMenuOpen(false);
  }, [scope]);

  useEffect(() => {
    onScopeChange?.(scope);
  }, [scope, onScopeChange]);

  useEffect(() => {
    if (!scopeMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const el = scopeWrapRef.current;
      if (el && !el.contains(event.target as Node)) {
        setScopeMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScopeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [scopeMenuOpen]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;

      try {
        const next =
          scope === "species"
            ? await getSpeciesSuggestionsClient(query, 20)
            : await getGeneSuggestionsClient(query, 20);
        if (requestSeqRef.current !== requestSeq) {
          return;
        }
        setSuggestions(next);
      } catch {
        // keep previous suggestions
      }
    }, 140);

    return () => clearTimeout(timer);
  }, [query, scope]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      return;
    }

    if (scope === "species") {
      const normalizedQuery = normalizeSpecies(q);
      const match =
        suggestions.find((item) => normalizeSpecies(item.name) === normalizedQuery) ?? suggestions[0];
      if (match) {
        router.push(speciesPageHref(match.slug ?? speciesNameToSlug(match.name)));
      }
      return;
    }

    const needle = q.toLowerCase();
    const match =
      suggestions.find(
        (item) => item.name.toLowerCase() === needle || item.slug.toLowerCase() === needle
      ) ?? suggestions[0];
    if (match) {
      router.push(genePageHref(match.slug ?? geneNameToSlug(match.name)));
    }
  };

  const pickSuggestion = (item: { name: string; slug: string }) => {
    setIsOpen(false);
    if (scope === "species") {
      router.push(speciesPageHref(item.slug ?? speciesNameToSlug(item.name)));
    } else {
      router.push(genePageHref(item.slug ?? geneNameToSlug(item.name)));
    }
  };

  const placeholder =
    variant === "hero"
      ? scope === "species"
        ? "Search for a species (e.g., Escherichia coli)"
        : "Search for a gene (e.g., FliG)"
      : scope === "species"
        ? "Species name…"
        : "Gene name…";

  return (
    <form className={cn(c.form, className)} onSubmit={onSubmit} role="search">
      <div className={c.bar}>
        <div className={c.scope} ref={scopeWrapRef}>
          <span className={c.scopeSizer} aria-hidden="true">
            Species
          </span>
          <button
            type="button"
            className={c.scopeTrigger}
            aria-expanded={scopeMenuOpen}
            aria-haspopup="listbox"
            aria-label="Search scope"
            onClick={() => setScopeMenuOpen((open) => !open)}
          >
            {scope === "species" ? "Species" : "Gene"}
          </button>
          {scopeMenuOpen ? (
            <ul className={c.scopeMenu} role="listbox">
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={scope === "species"}
                  className={c.scopeOption}
                  onClick={() => {
                    setScope("species");
                    setScopeMenuOpen(false);
                  }}
                >
                  Species
                </button>
              </li>
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={scope === "gene"}
                  className={c.scopeOption}
                  onClick={() => {
                    setScope("gene");
                    setScopeMenuOpen(false);
                  }}
                >
                  Gene
                </button>
              </li>
            </ul>
          ) : null}
        </div>

        <div className={c.inputWrap}>
          <span className={c.searchIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <line
                x1="16.65"
                y1="16.65"
                x2="21"
                y2="21"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            type="search"
            className={c.input}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
              }
              setIsOpen(true);
            }}
            onBlur={() => {
              hideTimerRef.current = setTimeout(() => setIsOpen(false), 120);
            }}
            aria-label={scope === "species" ? "Search species" : "Search genes"}
            autoComplete="off"
          />
          {isOpen && suggestions.length > 0 ? (
            <div
              className={cn(c.dropdown, "autocomplete-dropdown")}
              onMouseDown={(event) => event.preventDefault()}
            >
              {suggestions.map((item) => (
                <button
                  key={`${scope}-${item.slug}-${item.name}`}
                  type="button"
                  className="autocomplete-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickSuggestion(item)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}
