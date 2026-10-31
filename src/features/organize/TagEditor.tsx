import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { api, errorText, type ItemDetail } from "../../lib/api";
import { libraryChanged, useTags } from "../../lib/queries";

/** Splits typed text into tag names ("signed, first edition" → two tags). */
export function tagNames(text: string): string[] {
  return text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Suggestions for tag inputs: every tag already in the library. */
export function TagSuggestions({ id }: { id: string }) {
  const tags = useTags();
  return (
    <datalist id={id}>
      {tags.data?.map((tag) => (
        <option key={tag.id} value={tag.name} />
      ))}
    </datalist>
  );
}

/** An item's tags: links to each tag's page, removable, plus a field to add more. */
export function TagEditor({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (names: string[]) => {
    setError(null);
    try {
      await api.itemTagsSet(item.id, names);
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const add = () => {
    const names = tagNames(text);
    setText("");
    if (names.length) void save([...item.tags.map((tag) => tag.name), ...names]);
  };

  return (
    <div className="tag-editor">
      {item.tags.map((tag) => (
        <span key={tag.id} className="tag-chip">
          <Link to="/tag/$id" params={{ id: String(tag.id) }}>
            {tag.name}
          </Link>
          <button type="button" aria-label={`Remove tag ${tag.name}`} onClick={() => void save(item.tags.filter((t) => t.id !== tag.id).map((t) => t.name))}>
            <X size={12} strokeWidth={3} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        list={listId}
        placeholder={item.tags.length ? "Add another…" : "Add a tag…"}
        aria-label="Add a tag"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <TagSuggestions id={listId} />
      {error && <div className="dialog-error" style={{ flexBasis: "100%" }}>{error}</div>}
    </div>
  );
}
