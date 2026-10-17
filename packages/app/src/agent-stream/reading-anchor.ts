interface RowGeometry {
  id: string;
  top: number;
  height: number;
  preserveFollowingOnShrink?: boolean;
}

// A row must clear the reading line before the next row takes ownership.
const READING_POSITION_OFFSET_PX = 8;

/** Preserve the reader across layout changes using committed content coordinates.
 * Scroll events reuse those coordinates; visible text below a shrinking image keeps its boundary.
 */
export function createReadingAnchor() {
  let anchor: (RowGeometry & { followingVisible: boolean }) | null = null;
  let geometry: readonly RowGeometry[] = [];
  const readingRow = (scrollTop: number) =>
    geometry.find((row) => row.top + row.height > scrollTop + READING_POSITION_OFFSET_PX);
  /** Capture whether the image/text boundary is already visible to this reader. */
  const capture = (row: RowGeometry | undefined, scrollTop: number, viewportHeight: number) => {
    if (!row) return null;
    const boundary = row.top + row.height - scrollTop;
    const index = geometry.indexOf(row);
    return {
      ...row,
      followingVisible:
        !!row.preserveFollowingOnShrink &&
        index < geometry.length - 1 &&
        boundary > READING_POSITION_OFFSET_PX &&
        boundary < viewportHeight,
    };
  };
  /** Project without consuming geometry; range selection and layout share the same correction. */
  const project = (
    scrollTop: number,
    row: (Pick<RowGeometry, "id" | "top"> & Partial<Pick<RowGeometry, "height">>) | undefined,
  ) => {
    if (!anchor || row?.id !== anchor.id) return scrollTop;
    // Keep already-visible following text steady as an image contracts. Growth
    // retains the existing top policy, as does intentional collapse of other rows.
    const shrink =
      anchor.followingVisible && row.height !== undefined
        ? Math.min(0, row.height - anchor.height)
        : 0;
    return scrollTop + row.top - anchor.top + shrink;
  };
  return {
    getRowId: () => anchor?.id ?? null,
    getReadingRowId: (scrollTop: number) =>
      readingRow(scrollTop)?.id ?? geometry.at(-1)?.id ?? null,
    project,
    reset() {
      anchor = null;
    },
    scroll(scrollTop: number, viewportHeight = Infinity) {
      const next = readingRow(scrollTop);
      anchor = capture(next, scrollTop, viewportHeight);
    },
    reconcile(
      scrollTop: number,
      rows: readonly RowGeometry[],
      userScrolled = false,
      viewportHeight = Infinity,
    ): number {
      geometry = rows;
      const previous = anchor && rows.find((row) => row.id === anchor?.id);
      // The first virtualized commit can precede its mounted range. Keep the
      // pinned reader until it mounts, rather than adopting an unrelated row.
      if (anchor && !previous && !userScrolled) return scrollTop;
      const correctedTop = project(scrollTop, previous ?? undefined);
      // A prepend can expose the bottom of an estimated row above the reader.
      // Do not transfer ownership to it until the user moves the reading position.
      const next = previous && !userScrolled ? previous : readingRow(correctedTop);
      anchor = capture(next, correctedTop, viewportHeight);
      return correctedTop;
    },
  };
}
