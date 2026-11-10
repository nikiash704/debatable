import type { HTMLAttributes, ReactNode } from "react";

export interface ThesisGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  number: number;
  title: string;
  editor?: ReactNode;
  selected?: boolean;
  headProps?: HTMLAttributes<HTMLDivElement>;
  children?: ReactNode;
}

/** A thesis: 2 px left line plus a "1 · title" label (not in the mock; styled with the tokens). */
export function ThesisGroup({ number, title, editor, selected, headProps, children, className, ...rest }: ThesisGroupProps) {
  return (
    <div className={`thesis${selected ? " thesis--selected" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      <div className="thesis__head" {...headProps}>
        <span className="thesis__num">{number}</span>
        <span className="thesis__dot">·</span>
        {editor ? (
          <div className="thesis__title">{editor}</div>
        ) : (
          <span className={`thesis__title${title ? "" : " thesis__title--empty"}`} data-testid="thesis-title">
            {title || "Untitled thesis"}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
