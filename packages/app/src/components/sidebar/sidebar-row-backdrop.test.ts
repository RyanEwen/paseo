import { describe, expect, it } from "vitest";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";

describe("getSidebarRowBackdrop", () => {
  it("keeps selected rows on the selected surface while hovered", () => {
    expect(getSidebarRowBackdrop({ selected: true, isHovered: true })).toBe(
      "surfaceSidebarSelected",
    );
  });

  it("uses the hover surface for an unselected hovered row", () => {
    expect(getSidebarRowBackdrop({ isHovered: true })).toBe("surfaceSidebarHover");
  });
});

describe("project header backdrop", () => {
  it("matches the persistent fill and selected workspace hover color", () => {
    expect(getSidebarRowBackdrop({ rowKind: "project" })).toBe("surfaceSidebarHover");
    expect(getSidebarRowBackdrop({ rowKind: "project", isHovered: true })).toBe(
      "surfaceSidebarSelected",
    );
  });
  it("keeps pressed and dragging icon cutouts matched to their row", () => {
    expect(getSidebarRowBackdrop({ rowKind: "project", isHovered: true, isPressed: true })).toBe(
      "surface2",
    );
    expect(getSidebarRowBackdrop({ rowKind: "project", isDragging: true })).toBe("surface2");
  });
});
