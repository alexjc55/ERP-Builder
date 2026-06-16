import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTranslations,
  getListTranslationsQueryKey,
  useUpdateMe,
  getGetMeQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import type { MultilingualText } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

export type Lang = "ru" | "en" | "he";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "he", label: "עברית" },
];

const FALLBACK: Lang[] = ["ru", "en", "he"];

/** Pure, language-aware multilingual resolver. Falls back lang → ru → en → he. */
export function getML(
  val: MultilingualText | string | undefined | null,
  lang: Lang = "ru",
): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val[lang]) return val[lang] as string;
  for (const l of FALLBACK) {
    if (val[l]) return val[l] as string;
  }
  return "";
}

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Resolve a multilingual value into the current language. */
  ml: (val: MultilingualText | string | undefined | null) => string;
  /** Resolve a UI string key from the translations table, falling back to a literal. */
  t: (key: string, def: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function dirFor(lang: Lang): "ltr" | "rtl" {
  return lang === "he" ? "rtl" : "ltr";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();

  const [override, setOverride] = useState<Lang | null>(null);
  const langWriteSeq = useRef(0);

  // Platform default language (from app settings) is the fallback when the user
  // has no personal language preference yet.
  const { data: settings } = useGetSettings({
    query: { enabled: !!user, queryKey: getGetSettingsQueryKey() },
  });
  const defaultLang: Lang = (settings?.defaultLanguage as Lang | undefined) ?? "ru";

  const lang: Lang = override ?? (user?.language as Lang | undefined) ?? defaultLang;

  // Reset transient override once the persisted profile catches up, and clear
  // it entirely on logout so stale UI language/direction can't leak across sessions.
  useEffect(() => {
    if (!user) {
      if (override) setOverride(null);
      return;
    }
    if (override && user.language === override) {
      setOverride(null);
    }
  }, [override, user]);

  const { data: translations } = useListTranslations({
    query: { enabled: !!user, queryKey: getListTranslationsQueryKey() },
  });

  const tMap = useMemo(() => {
    const m = new Map<string, MultilingualText>();
    for (const tr of translations ?? []) {
      m.set(tr.translationKey, tr.translationsJson);
    }
    return m;
  }, [translations]);

  // Text direction and document language follow the active language.
  useEffect(() => {
    document.documentElement.dir = dirFor(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    const prev = lang;
    setOverride(next);
    if (!user) return;
    // Tag each write so a stale (out-of-order) response can't overwrite a newer one.
    const seq = ++langWriteSeq.current;
    updateMe.mutate(
      { data: { language: next, direction: dirFor(next) } },
      {
        onSuccess: () => {
          if (seq !== langWriteSeq.current) return;
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => {
          // Only roll back if this is still the most recent write.
          if (seq !== langWriteSeq.current) return;
          setOverride(prev === (user.language as Lang) ? null : prev);
        },
      },
    );
  };

  const value = useMemo<I18nContextType>(
    () => ({
      lang,
      setLang,
      ml: (val) => getML(val, lang),
      t: (key, def) => {
        const entry = tMap.get(key);
        const v = entry?.[lang];
        return v && v.length > 0 ? v : def;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, tMap, user],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (ctx === undefined) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}

export function useML() {
  return useI18n().ml;
}

export function useT() {
  return useI18n().t;
}

export function useLang() {
  const { lang, setLang } = useI18n();
  return { lang, setLang };
}
