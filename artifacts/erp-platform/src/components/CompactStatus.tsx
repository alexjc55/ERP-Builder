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
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle whitespace-nowrap ${className}`}>
      <span className="min-w-[3.5rem] shrink truncate font-medium" style={color ? { color } : undefined} title={name}>{name}</span>
      {displayTags && displayTags.length > 0 && (
        <span className="inline-flex min-w-0 max-w-[8rem] shrink items-center gap-1 overflow-hidden" title={displayTags.map(tag => ml(tag.nameJson)).join(", ")}>
          {displayTags.map(tag => (
            <span
              key={tag.id}
              className="inline-block min-w-0 max-w-[6rem] shrink truncate rounded border px-1 py-0 text-[10px] font-normal leading-4"
              style={{ borderColor: `${tag.color}80`, backgroundColor: `${tag.color}18`, color: tag.color }}
              title={ml(tag.nameJson)}
            >
              {ml(tag.nameJson)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}