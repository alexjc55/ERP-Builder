import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Choice = { value: string; label: string };

function revealOption(element: HTMLElement, list: HTMLElement) {
  const top = element.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + element.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = top + element.offsetHeight - list.clientHeight;
  }
}

/**
 * A non-modal listbox for an already-open inline editor. Keep positioning and
 * viewport collision handling in our shared Popover, but don't lock/re-layout
 * the entire document as a modal Select would on every cell opening.
 * Saving, retry and editor lifetime remain owned by InlineCellEditor.
 */
export function InlineListPicker({
  value, options, placeholder, label, onValueChange, onOpenChange,
}: {
  value: string;
  options: Choice[];
  placeholder: string;
  label: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setListElement(element);
  }, []);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeahead = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    const list = listElement;
    if (!open || !list) return;
    // Collision positioning supplies the available height after mount/focus.
    // Re-reveal the focused option when that final scroll viewport is sized.
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== list && list.contains(active)) {
        revealOption(active, list);
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [open, listElement]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) typeahead.current = { text: "", at: 0 };
    onOpenChange(next);
  };
  const focusOption = (index: number) => {
    const element = optionRefs.current[index];
    const list = listRef.current;
    if (!element || !list) return;
    element.focus({ preventScroll: true });
    // Scroll only the list, never the underlying table/page.
    revealOption(element, list);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    // The caller sets its commit/retry latch synchronously before close runs.
    if (option.value !== value) onValueChange(option.value);
    changeOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = Math.max(0, focusedIndex);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(Math.max(0, Math.min(options.length - 1,
        index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || (event.key === " " &&
      (!typeahead.current.text || performance.now() - typeahead.current.at >= 700))) {
      event.preventDefault();
      choose(index);
    } else if (event.key === "Tab") {
      // Match Select's open-menu keyboard behavior. Closing/unmounting the
      // trigger during Tab's default focus traversal would lose its target.
      event.preventDefault();
    } else if (event.key.length === 1) {
      event.preventDefault();
      const now = performance.now();
      const previous = now - typeahead.current.at < 700 ? typeahead.current.text : "";
      const text = previous + event.key.toLocaleLowerCase();
      typeahead.current = { text, at: now };
      const prefix = [...text].every((character) => character === text[0]) ? text[0] : text;
      for (let offset = 1; offset <= options.length; offset += 1) {
        const next = (index + offset) % options.length;
        if (options[next].label.toLocaleLowerCase().startsWith(prefix)) {
          focusOption(next);
          break;
        }
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          className="flex h-8 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring"
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={attachList}
        id={listId}
        role="listbox"
        aria-label={label}
        align="start"
        className="relative w-max min-w-[max(8rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-16px)] p-1"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusOption(selectedIndex < 0 ? 0 : selectedIndex);
        }}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            ref={(element) => { optionRefs.current[index] = element; }}
            id={`${listId}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === selectedIndex}
            data-highlighted={index === focusedIndex ? "" : undefined}
            data-state={index === selectedIndex ? "checked" : "unchecked"}
            onFocus={() => setFocusedIndex(index)}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse") event.currentTarget.focus({ preventScroll: true });
            }}
            onClick={() => choose(index)}
            className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 ps-2 pe-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
          >
            <span className="min-w-0 break-words">{option.label}</span>
            {index === selectedIndex && (
              <Check className="absolute end-2 h-4 w-4" aria-hidden="true" />
            )}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}