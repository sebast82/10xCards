export const navigationItems = [
  { id: "dashboard", label: "Start", href: "/dashboard" },
  { id: "generate", label: "Generowanie", href: "/generate" },
  { id: "deck", label: "Kolekcja", href: "/deck" },
] as const;

export function isNavigationItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
