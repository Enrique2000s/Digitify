// Digitify: the parts of foliate-js's view.js that Digitify uses (see README.md).

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface Book {
  metadata?: { title?: unknown; language?: string | string[] };
  toc?: TocItem[];
  dir?: string;
  rendition?: { layout?: string };
}

/** The `relocate` event's detail: where the reader is now. */
export interface Location {
  /** How far through the whole book, 0–1. */
  fraction: number;
  cfi: string;
  tocItem?: { label?: string; href?: string };
  location?: { current: number; next: number; total: number };
}

export interface Renderer extends HTMLElement {
  setStyles?(styles: string | [string, string]): void;
  readonly atEnd?: boolean;
}

export class View extends HTMLElement {
  book: Book;
  renderer: Renderer;
  isFixedLayout: boolean;
  lastLocation: Location | null;
  open(book: File | Blob | string): Promise<void>;
  close(): void;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  getSectionFractions(): number[];
}
