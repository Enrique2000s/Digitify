import type { Handler } from "./api";

export const FORMAT_LABELS: Record<string, string> = {
  epub: "EPUB",
  pdf: "PDF",
  mobi: "MOBI",
  azw: "AZW",
  azw3: "AZW3",
  fb2: "FB2",
  cbz: "CBZ",
  cbr: "CBR",
  cb7: "CB7",
  cbt: "CBT",
  images: "Page images",
  mkv: "MKV",
  mp4: "MP4",
  m4v: "M4V",
  mov: "MOV",
  avi: "AVI",
  webm: "WebM",
  wmv: "WMV",
  mpg: "MPEG",
  mpeg: "MPEG",
  ts: "TS",
  m2ts: "M2TS",
  ogv: "OGV",
  flv: "FLV",
  mp3: "MP3",
  flac: "FLAC",
  wav: "WAV",
  m4a: "M4A",
  aac: "AAC",
  ogg: "Ogg",
  oga: "Ogg",
  opus: "Opus",
  wma: "WMA",
  aiff: "AIFF",
  aif: "AIFF",
  ape: "APE",
  wv: "WavPack",
  dsf: "DSD",
  hardcover: "Hardcover",
  paperback: "Paperback",
  "mass-market": "Mass-market paperback",
  "box-set": "Box set",
  "single-issue": "Single issue",
  tpb: "Trade paperback",
  omnibus: "Omnibus",
  tankobon: "Tankōbon",
  dvd: "DVD",
  bluray: "Blu-ray",
  "uhd-bluray": "4K Blu-ray",
  "bluray-3d": "3D Blu-ray",
  vhs: "VHS",
  laserdisc: "LaserDisc",
  print: "Print",
  album: "Photo album",
  cd: "CD",
  vinyl: "Vinyl",
  cassette: "Cassette",
  sacd: "SACD",
  other: "Other",
};

export function formatLabel(code: string | null | undefined): string {
  if (!code) return "Unknown format";
  return FORMAT_LABELS[code] ?? code.toUpperCase();
}

/** Physical formats offered per kind of category, most common first. */
export const PHYSICAL_FORMATS: Record<Handler, string[]> = {
  book: ["hardcover", "paperback", "mass-market", "box-set", "other"],
  comic: ["single-issue", "tpb", "tankobon", "hardcover", "omnibus", "box-set", "other"],
  video: ["bluray", "uhd-bluray", "dvd", "bluray-3d", "vhs", "laserdisc", "box-set", "other"],
  audio: ["cd", "vinyl", "cassette", "sacd", "box-set", "other"],
  generic: ["other"],
  image: ["print", "album", "other"],
};

export const CONDITIONS = ["Sealed", "Mint", "Like new", "Very good", "Good", "Fair", "Poor"];

/** Main creator role per kind of category. */
export const CREATOR_ROLE: Record<Handler, { role: string; label: string }> = {
  book: { role: "author", label: "Author" },
  comic: { role: "writer", label: "Writer" },
  video: { role: "director", label: "Director" },
  audio: { role: "artist", label: "Artist" },
  generic: { role: "creator", label: "Creator" },
  image: { role: "photographer", label: "Photographer" },
};

export const ROLE_LABELS: Record<string, string> = {
  author: "Author",
  writer: "Writer",
  artist: "Artist",
  director: "Director",
  photographer: "Photographer",
  creator: "Creator",
};

export function duration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function longDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function bytes(size: number | null | undefined): string {
  if (size == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "";
  // Date-only values ("2024-05-01") are calendar dates, not UTC midnight.
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const parsed = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Local date and time from `YYYY-MM-DDTHH:MM:SS` (no time zone). */
export function dateTime(local: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local);
  if (!parts) return local;
  const [, y, mo, d, h, mi, s] = parts.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
