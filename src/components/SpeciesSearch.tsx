"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeSpeciesQuery,
  speciesNameToSlug
} from "@/lib/speciesNaming";

type SpeciesSearchProps = {
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  query?: string;
  onQueryChange?: (value: string) => void;
};

function normalize(value: string): string {
  return normalizeSpeciesQuery(value);
}

export default function SpeciesSearch({
  className,
  inputClassName,
  placeholder = "Search species...",
  query: controlledQuery,
  onQueryChange
}: SpeciesSearchProps) {
  const router = useRouter();
  const [internalQuery, setInternalQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; slug: string }>>(
    []
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const query = controlledQuery ?? internalQuery;

  const setQueryValue = (value: string) => {
    if (controlledQuery === undefined) {
      setInternalQuery(value);
    }
    onQueryChange?.(value);
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;

      try {
        const response = await fetch("/api/species-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            limit: 20
          })
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          suggestions?: Array<{ name: string; slug: string }>;
        };

        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        setSuggestions(payload.suggestions ?? []);
      } catch {
        // Keep the previous suggestions when the request fails.
      }
    }, 140);

    return () => clearTimeout(timer);
  }, [query]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      return;
    }

    const match =
      suggestions.find((item) => normalize(item.name) === normalizedQuery) ??
      suggestions[0];

    if (match) {
      router.push(`/species/${match.slug ?? speciesNameToSlug(match.name)}`);
      return;
    }

    router.push(`/species?query=${encodeURIComponent(query.trim())}`);
  };

  return (
    <form className={className} onSubmit={onSubmit} role="search">
      <div className="autocomplete-shell">
        <span className="search-input-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle
              cx="11"
              cy="11"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
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
          type="text"
          className={inputClassName}
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
            }
            setIsOpen(true);
          }}
          onBlur={() => {
            hideTimerRef.current = setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            setQueryValue(event.target.value);
            setIsOpen(true);
          }}
          aria-label="Search species"
          autoComplete="off"
        />
        {isOpen && suggestions.length > 0 ? (
          <div
            className="autocomplete-dropdown"
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((item) => (
              <button
                key={item.slug}
                type="button"
                className="autocomplete-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setIsOpen(false);
                  router.push(`/species/${item.slug ?? speciesNameToSlug(item.name)}`);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </form>
  );
}
