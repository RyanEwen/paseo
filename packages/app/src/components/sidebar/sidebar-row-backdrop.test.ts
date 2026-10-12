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

describe("sidebar row backdrop", () => {
  it("uses the sidebar surface at rest", () => {
    expect(getSidebarRowBackdrop({})).toBe("surfaceSidebar");
  });
  it("keeps pressed and dragging icon cutouts matched to their row", () => {
    expect(getSidebarRowBackdrop({ isHovered: true, isPressed: true })).toBe("surface2");
    expect(getSidebarRowBackdrop({ isDragging: true })).toBe("surface2");
  });
});
