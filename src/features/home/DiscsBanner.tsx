import { Link } from "@tanstack/react-router";
import { ChevronRight, Disc3 } from "lucide-react";
import { useDiscs } from "../../lib/discs";

/**
 * Home's "Discs" section: what a disc drive can do, so the feature is easy to find even before a
 * drive is connected, and which drives are ready when there are some.
 */
export function DiscsBanner() {
  const { drives } = useDiscs();
  const withDisc = drives.filter((drive) => drive.media);
  const text =
    drives.length === 0
      ? "Connect a CD, DVD or Blu-ray drive (an external USB one works) to play discs, rip audio CDs into your library, and import home-made DVDs and Blu-rays."
      : withDisc.length
        ? `A disc is in drive ${withDisc.map((d) => `${d.letter}:`).join(", ")}. Play it or rip it into your library.`
        : `Drive ${drives.map((d) => `${d.letter}:`).join(", ")} is ready. Put in a CD, DVD or Blu-ray to play it or rip it into your library.`;
  return (
    <Link to="/discs" className="discs-banner" data-blip>
      <span className={`discs-banner-icon${withDisc.length ? " spinning" : ""}`} aria-hidden>
        <Disc3 size={34} strokeWidth={2} />
      </span>
      <span className="discs-banner-text">
        <strong>{drives.length ? "Discs" : "Have CDs, DVDs or Blu-rays?"}</strong>
        <span>{text}</span>
      </span>
      <span className="btn btn-sm">
        Open Discs <ChevronRight size={15} />
      </span>
    </Link>
  );
}
