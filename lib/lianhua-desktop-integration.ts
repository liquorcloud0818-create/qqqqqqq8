import type { DesktopIconId } from "@/lib/desktop-config";
import {
  getDesktopIconLayoutItems,
  getDesktopPageKey,
  type DesktopFolderMap,
  type DesktopIconLayout,
} from "@/lib/desktop-layout-storage";
import {
  GRID_COLS,
  GRID_ROWS,
  WIDGET_SIZE_CELLS,
  type WidgetInstance,
} from "@/lib/widget-types";
import { isLianhuaPrivatePackageInstalled } from "@/lib/lianhua-private-storage";

/**
 * Add the private Lianhua icon only when this browser profile contains
 * the locally imported v0.5.27 package. It is deliberately excluded from
 * PAGE_1_DEFAULT / PAGE_2_DEFAULT / PAGE_3_DEFAULT.
 */
export function ensurePrivateLianhuaIcon(
  layout: DesktopIconLayout,
  widgets: WidgetInstance[] = [],
  dock: DesktopIconId[] = [],
  folders: DesktopFolderMap = {},
): { layout: DesktopIconLayout; changed: boolean } {
  if (!isLianhuaPrivatePackageInstalled()) {
    return { layout, changed: false };
  }

  const present = new Set<string>(dock);
  for (const item of getDesktopIconLayoutItems(layout)) present.add(item.id);
  for (const folder of Object.values(folders)) {
    for (const id of folder.icons) present.add(id);
  }
  if (present.has("lianhua")) return { layout, changed: false };

  const next = { ...layout } as DesktopIconLayout;

  for (let page = 1; page <= 50; page++) {
    const pageKey = getDesktopPageKey(page);
    const icons = next[pageKey] ?? [];
    const occupied: boolean[][] = Array.from(
      { length: GRID_ROWS },
      () => Array.from({ length: GRID_COLS }, () => false),
    );

    for (const widget of widgets) {
      if (widget.page !== page) continue;
      const size = WIDGET_SIZE_CELLS[widget.size];
      if (!size) continue;
      const [rows, cols] = size;
      for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
        for (let colOffset = 0; colOffset < cols; colOffset++) {
          const row = widget.row - 1 + rowOffset;
          const col = widget.col - 1 + colOffset;
          if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
            occupied[row][col] = true;
          }
        }
      }
    }

    for (const icon of icons) {
      const row = icon.row - 1;
      const col = icon.col - 1;
      if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
        occupied[row][col] = true;
      }
    }

    let freeCell: { row: number; col: number } | null = null;
    for (let row = 0; row < GRID_ROWS && !freeCell; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!occupied[row][col]) {
          freeCell = { row: row + 1, col: col + 1 };
          break;
        }
      }
    }

    if (freeCell) {
      next[pageKey] = [
        ...icons,
        { id: "lianhua", row: freeCell.row, col: freeCell.col },
      ];
      return { layout: next, changed: true };
    }
  }

  return { layout, changed: false };
}
