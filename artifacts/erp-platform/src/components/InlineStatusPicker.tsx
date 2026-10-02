import { useRef, type ComponentProps } from "react";
import { InlineListPicker } from "./InlineListPicker";

/**
 * A status menu must not modal-lock/re-layout the whole records table.
 * Keep its editor alive after selection until the parent's guarded ACK/error
 * path finishes; menu close runs in the same event before pending props paint.
 */
export function InlineStatusPicker({
  onCommit, onCancel, pending, ...props
}: Omit<ComponentProps<typeof InlineListPicker>, "onValueChange" | "onOpenChange"> & {
  onCommit: (value: string) => boolean;
  onCancel: () => void;
  pending: boolean;
}) {
  const selected = useRef(false);
  return (
    <InlineListPicker
      {...props}
      onValueChange={(value) => {
        selected.current = true;
        onCommit(value);
      }}
      onOpenChange={(open) => {
        if (open) selected.current = false;
        else if (!selected.current && !pending) onCancel();
      }}
    />
  );
}