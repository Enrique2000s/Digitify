import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { api, errorText, type ItemDetail } from "../../lib/api";
import { WindowButtons } from "../../components/TitleBar";
import { EbookReader } from "./EbookReader";
import { PageReader } from "./PageReader";

const PAGE_FILES = /\.(cbz|cbr|cb7|cbt|zip|rar|7z|tar|pdf|jpe?g|png|webp|gif|bmp|tiff?)$/i;
const EBOOK_FILES = /\.(epub|mobi|azw3?|fb2)$/i;
const IMAGE_FILES = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

/** Whether a reader can open this item: an ebook, a comic archive, a PDF, or a folder of images. */
export function canRead(item: ItemDetail): boolean {
  return item.versions.some(
    (version) =>
      version.kind === "digital" &&
      version.files.length > 0 &&
      (version.files.length === 1
        ? PAGE_FILES.test(version.files[0].path) || EBOOK_FILES.test(version.files[0].path)
        : version.files.every((file) => IMAGE_FILES.test(file.path))),
  );
}

/** `/read/$id`: the reader, full window, without the library's header. */
export function ReaderPage() {
  const { id } = useParams({ from: "/read/$id" });
  const { page } = useSearch({ from: "/read/$id" });
  const navigate = useNavigate();
  const book = useQuery({ queryKey: ["reader", Number(id)], queryFn: () => api.readerOpen(Number(id)), staleTime: 0, gcTime: 0, retry: false });
  const series = useQuery({ queryKey: ["series", Number(id)], queryFn: () => api.seriesGet(Number(id)) });
  const next = series.data ? (series.data.entries[series.data.index + 1] ?? null) : null;
  // The next volume replaces this one in history, so closing still goes back where reading began.
  const openNext = next ? () => void navigate({ to: "/read/$id", params: { id: String(next.id) }, replace: true }) : undefined;
  const close = () => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/item/$id", params: { id } });
  };

  if (book.data?.kind === "ebook") return <EbookReader key={book.data.itemId} book={book.data} onClose={close} next={next} onNext={openNext} />;
  if (book.data) return <PageReader key={book.data.itemId} book={book.data} startPage={page} onClose={close} next={next} onNext={openNext} />;
  return (
    <div className="reader">
      <header className="reader-bar top" data-tauri-drag-region>
        <button type="button" className="round-btn" aria-label="Back" onClick={close}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <span className="appbar-drag" data-tauri-drag-region />
        <WindowButtons />
      </header>
      <div className="reader-message">
        {book.isError ? (
          <>
            <h1 className="display">This can't be opened</h1>
            <p>{errorText(book.error)}</p>
            <button type="button" className="btn" onClick={close}>
              Back
            </button>
          </>
        ) : (
          <LoaderCircle size={34} className="spin" aria-label="Opening" />
        )}
      </div>
    </div>
  );
}
