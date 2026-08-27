import { useState } from "react";
import { ChevronRight, ChevronDown, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";

function JsonNode({ path, name, value, isLast, isParentArray }: { path: string, name: string, value: any, isLast: boolean, isParentArray?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const { toast } = useToast();
  const t = useT();

  const handleCopy = (e: React.MouseEvent, textToCopy: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(textToCopy);
    toast({ title: t("inbound.pathCopied", "Путь скопирован"), description: textToCopy, duration: 2000 });
  };

  const CopyButton = () => (
    <Button
      variant="ghost"
      size="icon"
      className="h-4 w-4 ms-2 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => handleCopy(e, path)}
      title={t("inbound.copyPath", "Копировать путь")}
    >
      <Copy className="h-3 w-3 text-slate-400 hover:text-slate-700" />
    </Button>
  );

  const displayKey = isParentArray ? null : <span className="text-slate-500 me-1">"{name}":</span>;

  if (value === null) {
    return (
      <div className="ps-4 flex items-center text-xs font-mono group">
        {displayKey}
        <span className="text-slate-400">null</span>
        {!isLast && <span className="text-slate-700">,</span>}
        <CopyButton />
      </div>
    );
  }
  
  if (typeof value !== "object") {
    const isString = typeof value === "string";
    return (
      <div className="ps-4 flex items-center text-xs font-mono group">
        {displayKey}
        <span className={`truncate max-w-sm ${isString ? "text-green-600" : "text-blue-600"}`} title={String(value)}>
          {isString ? `"${value}"` : String(value)}
        </span>
        {!isLast && <span className="text-slate-700">,</span>}
        <CopyButton />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const keys = Object.keys(value);
  const isEmpty = keys.length === 0;

  if (isEmpty) {
    return (
      <div className="ps-4 flex items-center text-xs font-mono group">
        {displayKey}
        <span className="text-slate-700">{isArray ? "[]" : "{}"}</span>
        {!isLast && <span className="text-slate-700">,</span>}
        <CopyButton />
      </div>
    );
  }

  return (
    <div className="ps-4 text-xs font-mono">
      <div className="flex items-center cursor-pointer select-none group" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-400 -ms-3 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-400 -ms-3 shrink-0" />}
        {displayKey}
        <span className="text-slate-700">{isArray ? "[" : "{"}</span>
        {!expanded && <span className="text-slate-400 px-1">...</span>}
        {!expanded && <span className="text-slate-700">{isArray ? "]" : "}"}</span>}
        {!expanded && !isLast && <span className="text-slate-700">,</span>}
        {!expanded && <CopyButton />}
      </div>
      {expanded && (
        <div className="border-s border-slate-200 ms-1 ps-1 py-0.5">
          {keys.map((k, i) => {
            const childPath = isArray 
              ? `${path}[${k}]` 
              : (path ? `${path}.${k}` : k);
            return (
              <JsonNode 
                key={k} 
                path={childPath} 
                name={k} 
                value={value[k as keyof typeof value]} 
                isLast={i === keys.length - 1} 
                isParentArray={isArray}
              />
            );
          })}
        </div>
      )}
      {expanded && (
        <div className="text-slate-700 ps-1 group flex items-center">
          {isArray ? "]" : "}"}{!isLast && ","}
          <CopyButton />
        </div>
      )}
    </div>
  );
}

export function JsonTree({ data }: { data: any }) {
  if (!data || typeof data !== "object") return null;
  const isArray = Array.isArray(data);
  const keys = Object.keys(data);
  return (
    <div className="font-mono text-xs bg-white border border-slate-200 rounded-md p-2 overflow-x-auto min-h-[100px]">
      <div className="text-slate-700">{isArray ? "[" : "{"}</div>
      <div className="border-s border-slate-200 ms-2 ps-1 py-1">
        {keys.map((k, i) => {
          const path = isArray ? `[${k}]` : k;
          return (
            <JsonNode 
              key={k} 
              path={path} 
              name={k} 
              value={data[k as keyof typeof data]} 
              isLast={i === keys.length - 1}
              isParentArray={isArray} 
            />
          );
        })}
      </div>
      <div className="text-slate-700">{isArray ? "]" : "}"}</div>
    </div>
  );
}
