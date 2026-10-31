import type { ReactNode } from "react";

/** One row of a settings panel: a title and explanation on the left, the control on the right. */
export function Setting({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <strong>{title}</strong>
        {text && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}
