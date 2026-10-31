// Page layout for the reader: which pages are shown together, and how big.

export interface PageSize {
  width: number;
  height: number;
}

export interface Box {
  width: number;
  height: number;
}

/** Landscape pages (a double-page spread already in the source) always stand alone. */
export const isWide = (page: PageSize) => page.width > page.height * 1.15;

/**
 * Groups pages into views: one page each, or facing pairs in two-page mode. In two-page mode the
 * cover can stand alone so that later pairs line up the way the printed book does.
 */
export function buildViews(pages: PageSize[], spread: boolean, coverAlone: boolean): number[][] {
  if (!spread) return pages.map((_, index) => [index]);
  const views: number[][] = [];
  let index = 0;
  if (coverAlone && pages.length > 0) {
    views.push([0]);
    index = 1;
  }
  while (index < pages.length) {
    const pair = index + 1 < pages.length && !isWide(pages[index]) && !isWide(pages[index + 1]);
    views.push(pair ? [index, index + 1] : [index]);
    index += pair ? 2 : 1;
  }
  return views;
}

/** The view that shows `page`. */
export function viewOf(views: number[][], page: number): number {
  const index = views.findIndex((view) => view.includes(page));
  return index < 0 ? 0 : index;
}

/** The height (CSS pixels) at which a view's pages, side by side, fit the stage. */
export function viewHeight(view: number[], pages: PageSize[], stage: Box, fit: "page" | "width"): number {
  const ratio = view.reduce((sum, index) => sum + pages[index].width / pages[index].height, 0);
  const byWidth = stage.width / ratio;
  return Math.max(1, fit === "width" ? byWidth : Math.min(stage.height, byWidth));
}

/** A page's width in the continuous strip: as wide as the stage, or a whole page per screen. */
export function stripWidth(page: PageSize, stage: Box, fit: "page" | "width"): number {
  const byHeight = (stage.height * page.width) / page.height;
  return Math.max(1, fit === "width" ? Math.min(stage.width, 1400) : Math.min(stage.width, byHeight));
}
