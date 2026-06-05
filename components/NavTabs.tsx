"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Cast" },
  { href: "/relationships", label: "Bonds" },
  { href: "/network", label: "Network" },
];

/** Header navigation tabs with an active state (cardinal fill). The Cast tab
 *  also lights up on individual chat pages, since those are reached from it. */
export default function NavTabs() {
  const path = usePathname();
  return (
    <nav style={{ display: "flex", gap: 6 }}>
      {TABS.map((t) => {
        const active =
          t.href === "/"
            ? path === "/" || path.startsWith("/chat")
            : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="px"
            style={{
              fontSize: 13,
              padding: "6px 13px",
              borderRadius: 11,
              textDecoration: "none",
              border: "2px solid " + (active ? "var(--accent-2)" : "transparent"),
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-ink)" : "var(--ink-2)",
              transition: "background .15s, color .15s",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
