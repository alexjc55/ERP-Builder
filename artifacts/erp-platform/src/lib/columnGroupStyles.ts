export type ColumnGroupBodySource = {
  bodyBackgroundColor?: string | null;
  bodyTextColor?: string | null;
};

export type ColumnGroupBodyStyle = {
  backgroundColor?: string;
  color?: string;
};

/** Header fields are intentionally not read here: body styling is independent. */
export function columnGroupBodyStyle(group: ColumnGroupBodySource | null | undefined): ColumnGroupBodyStyle | undefined {
  const backgroundColor = group?.bodyBackgroundColor ?? undefined;
  const color = group?.bodyTextColor ?? undefined;
  return backgroundColor || color ? { backgroundColor, color } : undefined;
}

/** Conditional cell/row formatting always wins over the group base palette. */
export function resolveColumnGroupCellStyle(
  groupStyle: ColumnGroupBodyStyle | undefined,
  conditional: { rowColor?: string; cellColor?: string; textColor?: string },
): ColumnGroupBodyStyle | undefined {
  const backgroundColor = conditional.cellColor ?? conditional.rowColor ?? groupStyle?.backgroundColor;
  const color = conditional.textColor ?? groupStyle?.color;
  return backgroundColor || color ? { backgroundColor, color } : undefined;
}