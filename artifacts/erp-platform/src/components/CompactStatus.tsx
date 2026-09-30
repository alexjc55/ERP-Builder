import type { MultilingualText } from "@workspace/api-client-react";

export type DisplayStatusTag = { id: number; nameJson: MultilingualText; color: string };

/**
 * A status and its server-filtered display tags. The server decides whether tags
 * are hidden or narrowed to the preferred tag; do not derive them from tagIds.
 */
export function CompactStatus({
  name,
  color,
  displayTags,
  ml,
  className = "",
}: {
  name: string;
  color?: string | null;
  displayTags?: readonly DisplayStatusTag[] | null;
  ml: (value: MultilingualText | null | undefined) => string;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 max-w-full flex-col items-start align-middle whitespace-normal text-start ${className}`}>
      {displayTags && displayTags.length > 0 && (
        <span className="max-w-full text-[10px] font-normal leading-3 text-slate-600 [overflow-wrap:anywhere]" title={displayTags.map(tag => ml(tag.nameJson)).join(", ")}>
          {displayTags.map(tag => ml(tag.nameJson)).join(" · ")}
        </span>
      )}
      <span className="max-w-full font-medium leading-4 [overflow-wrap:anywhere]" style={color ? { color } : undefined} title={name}>{name}</span>
    </span>
  );
}