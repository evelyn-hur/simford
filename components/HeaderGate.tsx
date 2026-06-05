"use client";

import { usePathname } from "next/navigation";

/**
 * Renders the game chrome (Header) everywhere EXCEPT the external rating survey
 * at /eval-rate, which is shared with outside raters and must not expose game
 * navigation or the Restart control. The Header is still rendered on the server
 * and passed in as children; this just decides whether to show it.
 */
export default function HeaderGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path?.startsWith("/eval-rate")) return null;
  return <>{children}</>;
}
