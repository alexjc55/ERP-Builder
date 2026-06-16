import { useEffect, useMemo, useState } from "react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface MultilingualValue {
  ru?: string;
  en?: string;
  he?: string;
}

interface MultilingualInputProps {
  label: string;
  value: MultilingualValue;
  onChange: (value: MultilingualValue) => void;
  multiline?: boolean;
  required?: boolean;
  onActiveLangChange?: (lang: string) => void;
}

const LANGS = [
  { code: "ru", label: "RU", name: "Русский" },
  { code: "en", label: "EN", name: "English" },
  { code: "he", label: "HE", name: "עברית" },
] as const;

export function MultilingualInput({
  label,
  value,
  onChange,
  multiline = false,
  required = false,
  onActiveLangChange,
}: MultilingualInputProps) {
  // Lead with and open on the platform default language so the admin-configured
  // default visibly drives multilingual content entry (primary language first).
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  const defaultLang = (settings?.defaultLanguage as string) ?? "ru";

  const orderedLangs = useMemo(
    () => [...LANGS].sort((a, b) => Number(b.code === defaultLang) - Number(a.code === defaultLang)),
    [defaultLang],
  );

  const [active, setActive] = useState(defaultLang);
  useEffect(() => {
    setActive(defaultLang);
  }, [defaultLang]);
  useEffect(() => {
    onActiveLangChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleChange = (lang: string, text: string) => {
    onChange({ ...value, [lang]: text });
  };

  const InputComp = multiline ? Textarea : Input;

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <Tabs value={active} onValueChange={setActive} className="w-full">
        <TabsList className="h-8 bg-slate-100 p-0.5">
          {orderedLangs.map((lang) => (
            <TabsTrigger
              key={lang.code}
              value={lang.code}
              className="text-xs px-3 h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {lang.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {LANGS.map((lang) => (
          <TabsContent key={lang.code} value={lang.code} className="mt-2">
            <InputComp
              value={value[lang.code] || ""}
              onChange={(e) => handleChange(lang.code, e.target.value)}
              placeholder={`${label} (${lang.name})`}
              dir={lang.code === "he" ? "rtl" : "ltr"}
              className="text-sm"
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
