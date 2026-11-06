import { Link } from "@tanstack/react-router";
import { LibraryBig, Star, Tag } from "lucide-react";
import { useCategories, useDashboard } from "../lib/queries";
import { CategoryIcon } from "./common";

/** Pills for jumping between library sections; the home tiles do the same on the Home screen. */
export function CategoryStrip() {
  const categories = useCategories();
  const dashboard = useDashboard();
  const total = dashboard.data?.totals.items;
  return (
    <nav className="category-strip" aria-label="Library sections">
      <Link to="/library/$scope" params={{ scope: "all" }} className="strip-pill" data-blip>
        <LibraryBig size={17} strokeWidth={2.2} aria-hidden />
        Everything
        {total != null && <span className="count">{total.toLocaleString()}</span>}
      </Link>
      {categories.data
        ?.filter((category) => !category.isHidden)
        .map((category) => (
          <Link
            key={category.key}
            to="/library/$scope"
            params={{ scope: category.key }}
            activeOptions={{ includeSearch: false }}
            className="strip-pill"
            data-blip
          >
            <CategoryIcon icon={category.icon} size={17} />
            {category.name}
            <span className="count">{category.itemCount.toLocaleString()}</span>
          </Link>
        ))}
      <Link to="/library/$scope" params={{ scope: "favorites" }} className="strip-pill" data-blip>
        <Star size={17} strokeWidth={2.2} aria-hidden />
        Favorites
      </Link>
      <Link to="/tags" className="strip-pill" data-blip>
        <Tag size={17} strokeWidth={2.2} aria-hidden />
        Tags
      </Link>
    </nav>
  );
}
