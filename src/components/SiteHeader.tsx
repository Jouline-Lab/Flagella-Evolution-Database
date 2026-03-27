import Link from "next/link";
import SpeciesSearch from "@/components/SpeciesSearch";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  {
    label: "Gene Table",
    href: "/phyletic-distribution-table"
  },
  {
    label: "Phyletic Visualization",
    href: "/phyletic-distribution-visualization"
  },
  { label: "FAQ", href: "/faq" },
  { label: "Cite Us", href: "/cite-us" }
];

export default function SiteHeader() {
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand brand-link">
          <span className="brand-line">Flagellar Evolution</span>
          <span className="brand-line">Database</span>
        </Link>
        <div className="topbar-right">
          <nav aria-label="Main navigation">
            <ul className="nav-list">
              {navItems.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="nav-link">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <SpeciesSearch
            className="topbar-search"
            inputClassName="species-search-input species-search-input-compact"
            placeholder="Search species"
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
