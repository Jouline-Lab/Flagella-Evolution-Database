"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ScopeSearchBar from "@/components/search/ScopeSearchBar";
import ThemeToggle from "@/components/ThemeToggle";
import { withBasePath } from "@/lib/assetPaths";

const toolNavItems = [
  {
    label: "Gene Table",
    href: "/phyletic-distribution-table",
    description: "Browse and generate tables of flagellar gene presence"
  },
  {
    label: "Phyletic Visualization",
    href: "/phyletic-distribution-visualization",
    description: "Visualize gene distribution across lineages"
  },
  {
    label: "Gene Co-presence",
    href: "/gene-correlation",
    description: "Visualize and cluster flagellar genes by co-presence patterns"
  },
  {
    label: "Gene Retention and Absence",
    href: "/gene-retention-absence",
    description: "Explore gene retention and absence patterns"
  }
];

const navItems = [
  { label: "FAQ", href: "/faq" },
  { label: "Cite Us", href: "/cite-us" },
  { label: "Contact", href: "/contact" }
];

export default function SiteHeader() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [isRouteResetting, setIsRouteResetting] = useState(false);

  useEffect(() => {
    setIsRouteResetting(true);
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && headerRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  }, [pathname]);

  return (
    <header
      ref={headerRef}
      className="topbar"
      data-route-reset={isRouteResetting ? "true" : undefined}
      onMouseLeave={() => setIsRouteResetting(false)}
      onFocus={() => setIsRouteResetting(false)}
    >
      <div className="container topbar-inner">
        <Link href="/" className="brand brand-link" aria-label="Flagella Database home">
          <img
            src={withBasePath("/flagelladb_logo.svg")}
            alt=""
            className="brand-logo brand-logo-light"
          />
          <img
            src={withBasePath("/flagelladb_logo_dark.svg")}
            alt=""
            className="brand-logo brand-logo-dark"
          />
        </Link>
        <div className="topbar-right">
          <nav className="topbar-nav" aria-label="Main navigation">
            <ul className="nav-list">
              <li className="nav-dropdown-item">
                <div className="nav-dropdown">
                  <button
                    type="button"
                    className="nav-link nav-dropdown-trigger"
                    aria-haspopup="true"
                  >
                    Tools
                  </button>
                  <ul className="nav-dropdown-menu">
                    {toolNavItems.map((item) => (
                      <li key={item.label}>
                        <Link href={item.href} className="nav-dropdown-link">
                          <span className="nav-dropdown-link-title">{item.label}</span>
                          <span className="nav-dropdown-link-description">{item.description}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
              {navItems.map((item) => (
                <li key={item.label} className="nav-standard-item">
                  <Link href={item.href} className="nav-link">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="nav-dropdown-item nav-compact-item">
                <div className="nav-dropdown">
                  <button
                    type="button"
                    className="nav-link nav-menu-trigger"
                    aria-haspopup="true"
                    aria-label="Open navigation menu"
                  >
                    <span className="nav-menu-icon" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>
                  <ul className="nav-dropdown-menu nav-compact-menu">
                    <li className="nav-compact-section-label">Tools</li>
                    {toolNavItems.map((item) => (
                      <li key={item.label}>
                        <Link href={item.href} className="nav-dropdown-link">
                          <span className="nav-dropdown-link-title">{item.label}</span>
                          <span className="nav-dropdown-link-description">{item.description}</span>
                        </Link>
                      </li>
                    ))}
                    <li className="nav-compact-section-label">Pages</li>
                    {navItems.map((item) => (
                      <li key={item.label}>
                        <Link href={item.href} className="nav-dropdown-link">
                          <span className="nav-dropdown-link-title">{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            </ul>
          </nav>
          <ScopeSearchBar variant="compact" className="topbar-search" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
