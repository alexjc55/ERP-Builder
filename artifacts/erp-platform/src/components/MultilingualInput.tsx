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
}: MultilingualInputProps) {
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
      <Tabs defaultValue="ru" className="w-full">
        <TabsList className="h-8 bg-slate-100 p-0.5">
          {LANGS.map((lang) => (
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
