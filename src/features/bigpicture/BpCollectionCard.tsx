import type { ReactNode } from "react";
import { Marquee } from "../../components/Marquee";
import { artworkUrl } from "../../lib/api";

/**
 * A collection as a big card in Big Picture (D-149), for Library's and Arcade's collections alike:
 * up to four of its covers, its name, and what it holds. A opens it.
 */
export function BpCollectionCard({ name, detail, covers, icon, badge, autofocus, onOpen }: { name: string; detail: string; covers: string[]; icon: ReactNode; badge?: ReactNode; autofocus?: boolean; onOpen: () => void }) {
  const shown = covers.slice(0, 4);
  return (
    <button type="button" className="bp-collection" data-bp-focus data-bp-autofocus={autofocus || undefined} onClick={onOpen}>
      <span className={`bp-collage n${shown.length}`} aria-hidden>
        {shown.length === 0 ? <span className="bp-collage-empty">{icon}</span> : shown.map((key) => <img key={key} src={artworkUrl(key, "thumb")} alt="" loading="lazy" decoding="async" draggable={false} />)}
      </span>
      <span className="bp-collection-name">
        <Marquee hover text={name} />
      </span>
      <span className="bp-collection-detail">
        {detail}
        {badge}
      </span>
    </button>
  );
}
