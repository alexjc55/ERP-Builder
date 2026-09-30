import type { MultilingualText } from "@workspace/api-client-react";

export type DisplayStatusTag = { id: number; nameJson: MultilingualText; color: string };

/**
 * A status and its server-filtered display tags. The server decides whether tags
 * are hidden or narrowed to the preferred tag; do not derive them from tagIds.
 */
export function CompactStatus({
  name,
  color,
  badgeColor,
  displayTags,
  ml,
  className = "",
}: {
  name: string;
  color?: string | null;
  /** Optional high-contrast badge for pickers; otherwise retain the usual colored text. */
  badgeColor?: string | null;
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
      {badgeColor ? (
        <span
          className="inline-flex max-w-full items-start gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium leading-4 text-slate-900 [overflow-wrap:anywhere]"
          style={{ backgroundColor: `color-mix(in srgb, ${badgeColor} 12%, white)` }}
          title={name}
        >
          <span
            data-status-color-dot
            aria-hidden="true"
            className="mt-1 h-2 w-2 shrink-0 rounded-full border border-slate-500/60"
            style={{ backgroundColor: badgeColor }}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
        </span>
      ) : (
        <span className="max-w-full font-medium leading-4 [overflow-wrap:anywhere]" style={color ? { color } : undefined} title={name}>{name}</span>
      )}
    </span>
  );
}