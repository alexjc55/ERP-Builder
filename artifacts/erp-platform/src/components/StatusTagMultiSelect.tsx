import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useML, useT } from "@/lib/i18n";
import { listTags, tagsQueryKey } from "@/lib/tags";
import {
  applicableStatusTags,
  toggleStatusTagId,
  type StatusTag,
  type TaggedStatus,
} from "./StatusTagMultiSelect.logic";

export type { StatusTag, TaggedStatus } from "./StatusTagMultiSelect.logic";

export function useStatusTags() {
  return useQuery<StatusTag[]>({
    queryKey: tagsQueryKey,
    queryFn: () => listTags() as Promise<StatusTag[]>,
    staleTime: 60_000,
  });
}

export function StatusTagMultiSelect({
  value,
  statuses,
  onChange,
  label,
  placeholder,
  disabled = false,
}: {
  value: number[];
  statuses: TaggedStatus[];
  onChange: (next: number[]) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ml = useML();
  const t = useT();
  const { data: tags = [], isLoading } = useStatusTags();
  const options = useMemo(() => applicableStatusTags(tags, statuses, value), [tags, statuses, value]);
  const selectedTags = value.map((id) => tags.find((tag) => tag.id === id) ?? {
    id,
    nameJson: null,
    color: null,
  });
  const buttonText =
    selectedTags.length > 0
      ? selectedTags.map((tag) => ml(tag.nameJson) || `#${tag.id}`).join(", ")
      : placeholder ?? t("statusTags.none", "Не выбрано");

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400">{label}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isLoading}
            className="h-auto min-h-8 w-full justify-between gap-2 px-2 text-left font-normal"
          >
            <span className="min-w-0 truncate">{isLoading ? t("statusTags.loading", "Загрузка…") : buttonText}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-2" align="start">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-slate-400">
              {t("statusTags.empty", "Для статусов этой сущности нет тегов")}
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {options.map((tag) => (
                <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <Checkbox
                    checked={value.includes(tag.id)}
                    onCheckedChange={() => onChange(toggleStatusTagId(value, tag.id))}
                  />
                  {tag.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />}
                  <span className="min-w-0 truncate">{ml(tag.nameJson) || `#${tag.id}`}</span>
                  {value.includes(tag.id) && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-blue-600" />}
                </label>
              ))}
            </div>
          )}
          {value.length > 0 && (
            <button
              type="button"
              className="mt-1 flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3" />
              {t("statusTags.clear", "Очистить")}
            </button>
          )}
        </PopoverContent>
      </Popover>
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="gap-1 text-[11px]">
              {tag.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />}
              {ml(tag.nameJson) || `#${tag.id}`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}