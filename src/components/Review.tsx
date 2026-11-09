import { useEffect, useState } from "react";
import { Star } from "lucide-react";

/** 1-5 stars; choosing the current rating again clears it (D-049). */
export function StarRating({ value, onChange, size = 22 }: { value: number | null; onChange: (rating: number | null) => void; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="star-rating" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
          title={value === n ? "Clear the rating" : `${n} ${n === 1 ? "star" : "stars"}`}
          className={n <= shown ? "on" : undefined}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? null : n)}
        >
          <Star size={size} fill={n <= shown ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

/** Your rating and your notes for an item or a game; the note saves when you leave the box. */
export function ReviewPanel({ rating, note, onSave, compact }: { rating: number | null; note: string | null; onSave: (rating: number | null, note: string | null) => void; compact?: boolean }) {
  const [text, setText] = useState(note ?? "");
  useEffect(() => setText(note ?? ""), [note]);
  return (
    <div className={`review${compact ? " compact" : ""}`}>
      <div className="review-head">
        <span>Your rating</span>
        <StarRating value={rating} onChange={(r) => onSave(r, text.trim() || null)} size={compact ? 18 : 22} />
      </div>
      <textarea
        className="input review-note"
        placeholder="Your notes: what you thought, where you left off, who lent it to you…"
        value={text}
        rows={compact ? 3 : 4}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if ((note ?? "") !== text.trim()) onSave(rating, text.trim() || null);
        }}
      />
    </div>
  );
}
