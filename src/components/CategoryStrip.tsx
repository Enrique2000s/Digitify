import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LibraryBig } from "lucide-react";
import { useCategories, useDashboard } from "../lib/queries";
import { useArrival } from "../lib/arrival";
import { usePreferences } from "../lib/preferences";

/** Library's header and its sections as buttons, like Arcade's (D-042); Home's tiles do the same on Home. */
export function CategoryStrip({ tools }: { tools?: ReactNode }) {
  const categories = useCategories();
  const dashboard = useDashboard();
  const total = dashboard.data?.totals.items;
  const { preferences } = usePreferences();
  // Fades in like Arcade's page when Library is opened, and holds still when only the view changes.
  const arriving = useArrival("library-chrome");
  return (
    <>
      {/* Library's own header, like Arcade's (D-042). */}
      <header className={`arcade-head library-head${arriving ? " arriving" : ""}`}>
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
      <div className={`arcade-toolbar library-toolbar${arriving ? " arriving" : ""}`}>
      <nav className="segmented category-strip" aria-label="Library sections">
        {/* Everything only when turned on in Settings (D-074). */}
        {preferences.showEverything && (
          <Link to="/library/$scope" params={{ scope: "all" }} className="strip-pill" data-blip>
            Everything
            {total != null && <span className="count">{total.toLocaleString()}</span>}
          </Link>
        )}
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
        <Link to="/smart" className="strip-pill" activeOptions={{ exact: false }} data-blip>
          Smart lists
        </Link>
      </nav>
      {/* Always there, even empty (Music's other tabs), so nothing moves between views. */}
      <div className="view-tools">{tools}</div>
      </div>
    </>
  );
}
