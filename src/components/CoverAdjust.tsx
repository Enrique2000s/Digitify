import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { artworkUrl, errorText, type CoverView } from "../lib/api";
import { Dialog } from "./common";
import { PictureAdjuster } from "../features/profile/Picture";

/**
 * Adjusting a cover (D-184), as a profile picture is adjusted: in a frame of the cover's own shape,
 * the picture dragged to choose its middle and zoomed with the slider or the wheel; Reset brings it
 * back as it comes. For music, videos, Movies & Series, books and Arcade's games.
 */
export function CoverAdjustDialog({
  title,
  coverKey,
  aspect,
  round = false,
  view,
  onSave,
  onClose,
}: {
  title: string;
  coverKey: string;
  aspect: number;
  round?: boolean;
  view: CoverView | null;
  onSave: (view: CoverView | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState({ zoom: view?.zoom ?? 1, x: view?.x ?? 50, y: view?.y ?? 50 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const plain = current.zoom === 1 && current.x === 50 && current.y === 50;
      await onSave(plain ? null : { ...current, key: coverKey });
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setCurrent({ zoom: 1, x: 50, y: 50 })}>
            <RotateCcw size={15} /> Reset
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <PictureAdjuster picture={artworkUrl(coverKey, "cover")} view={current} onChange={setCurrent} kind="cover" aspect={aspect} round={round} />
      {error && <p className="dialog-error">{error}</p>}
    </Dialog>
  );
}
