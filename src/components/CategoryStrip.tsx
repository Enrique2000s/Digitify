import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LibraryBig } from "lucide-react";
import { useCategories, useDashboard } from "../lib/queries";

/** Library's header and its sections as buttons, like Arcade's (D-042); Home's tiles do the same on Home. */
export function CategoryStrip({ tools }: { tools?: ReactNode }) {
  const categories = useCategories();
  const dashboard = useDashboard();
  const total = dashboard.data?.totals.items;
  return (
    <>
      {/* Library's own header, like Arcade's (D-042). */}
      <header className="arcade-head library-head">
        <div className="arcade-head-title">
          <span className="arcade-logo library-logo" aria-hidden>
            <LibraryBig size={26} strokeWidth={2.3} />
          </span>
          <div>
            <h1 className="display">Library</h1>
            <p>Your pictures, music, videos, movies and series, books, comics and manga, kept on this computer.</p>
          </div>
        </div>
      </header>
      {/* The sections as Arcade's view buttons, with the view's find, Select, Size and Sort beside
          them, as in Arcade's toolbar (D-043). */}
      <div className="arcade-toolbar library-toolbar">
      <nav className="segmented category-strip" aria-label="Library sections">
        <Link to="/library/$scope" params={{ scope: "all" }} className="strip-pill" data-blip>
          Everything
          {total != null && <span className="count">{total.toLocaleString()}</span>}
        </Link>
        {categories.data
          ?.filter((category) => !category.isHidden)
          .map((category) => (
            <Link key={category.key} to="/library/$scope" params={{ scope: category.key }} activeOptions={{ includeSearch: false }} className="strip-pill" data-blip>
              {category.name}
              <span className="count">{category.itemCount.toLocaleString()}</span>
            </Link>
          ))}
        <Link to="/library/$scope" params={{ scope: "favorites" }} className="strip-pill" data-blip>
          Favorites
        </Link>
        <Link to="/tags" className="strip-pill" data-blip>
          Tags
        </Link>
      </nav>
      {/* Always there, even empty (Music's other tabs), so nothing moves between views. */}
      <div className="view-tools">{tools}</div>
      </div>
    </>
  );
}
