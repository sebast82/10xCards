import { describe, expect, it } from "vitest";
import { isNavigationItemActive, navigationItems } from "./navigation";

describe("navigationItems", () => {
  it("contains every available application section", () => {
    expect(navigationItems).toEqual([
      { id: "dashboard", label: "Start", href: "/dashboard" },
      { id: "generate", label: "Generowanie", href: "/generate" },
      { id: "deck", label: "Kolekcja", href: "/deck" },
    ]);
  });
});

describe("isNavigationItemActive", () => {
  it.each(navigationItems)("matches the exact $href route", ({ href }) => {
    expect(isNavigationItemActive(href, href)).toBe(true);
  });

  it("matches a nested route within a section", () => {
    expect(isNavigationItemActive("/deck/card-id", "/deck")).toBe(true);
  });

  it("does not match a different section", () => {
    expect(isNavigationItemActive("/generate", "/deck")).toBe(false);
  });

  it("does not match a shared character prefix", () => {
    expect(isNavigationItemActive("/decking", "/deck")).toBe(false);
  });

  it("leaves an unknown path without an active section", () => {
    expect(navigationItems.some(({ href }) => isNavigationItemActive("/unknown", href))).toBe(false);
  });
});
