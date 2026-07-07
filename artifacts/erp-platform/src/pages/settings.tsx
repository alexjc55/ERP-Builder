import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateMe,
  useChangePassword,
  useGetSettings,
  useUpdateSettings,
  useListLocalFolders,
  useCreateLocalFolder,
  useDeleteLocalFolder,
  getGetMeQueryKey,
  getGetSettingsQueryKey,
  getListLocalFoldersQueryKey,
  type MultilingualText,
  type LocalFolder,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useT, LANGS, type Lang } from "@/lib/i18n";
import { uploadBrandingLogo } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultilingualInput } from "@/components/MultilingualInput";
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { useToast } from "@/hooks/use-toast";
import { Building2, User, Lock, Image as ImageIcon, Loader2, Upload, Trash2, FolderTree } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

export default function SettingsPage() {
  const { user, isSuperAdmin, canAdmin } = useAuth();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canBranding = isSuperAdmin || canAdmin("settings");

  // ---- Profile ----
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [language, setLanguage] = useState<"ru" | "en" | "he">("ru");
  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setLanguage((user?.language as "ru" | "en" | "he") ?? "ru");
  }, [user?.firstName, user?.lastName, user?.language]);

  const updateMe = useUpdateMe();
  const saveProfile = async () => {
    try {
      const updated = await updateMe.mutateAsync({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          language,
          direction: language === "he" ? "rtl" : "ltr",
        },
      });
      queryClient.setQueryData(getGetMeQueryKey(), updated);
      toast({ title: t("settings.profileSaved", "Профиль обновлён") });
    } catch {
      toast({ title: t("settings.saveError", "Не удалось сохранить"), variant: "destructive" });
    }
  };

  // ---- Password ----
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useChangePassword();
  const submitPassword = async () => {
    if (newPassword.length < 6) {
      toast({ title: t("settings.passwordTooShort", "Пароль должен быть не короче 6 символов"), variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t("settings.passwordMismatch", "Пароли не совпадают"), variant: "destructive" });
      return;
    }
    try {
      await changePassword.mutateAsync({ data: { currentPassword, newPassword } });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: t("settings.passwordChanged", "Пароль изменён") });
    } catch {
      toast({ title: t("settings.passwordError", "Не удалось изменить пароль. Проверьте текущий пароль."), variant: "destructive" });
    }
  };

  // ---- Branding ----
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), enabled: canBranding },
  });
  const [appNameJson, setAppNameJson] = useState<MLValue>({});
  const [subtitleJson, setSubtitleJson] = useState<MLValue>({});
  const [logoObjectPath, setLogoObjectPath] = useState<string | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState<string>("₽");
  const [defaultLanguage, setDefaultLanguage] = useState<Lang>("ru");
  const [tableStyle, setTableStyle] = useState<string>("plain");
  const [tableStripeColor, setTableStripeColor] = useState<string>("");
  const [tableHeaderColor, setTableHeaderColor] = useState<string>("");
  const [tableBorderColor, setTableBorderColor] = useState<string>("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateSettings = useUpdateSettings();

  useEffect(() => {
    if (!settings) return;
    const n = settings.appNameJson as MLValue | undefined;
    const s = settings.subtitleJson as MLValue | undefined;
    setAppNameJson(n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setSubtitleJson(s ? { ru: s.ru, en: s.en, he: s.he } : {});
    setLogoObjectPath(settings.logoObjectPath ?? null);
    setCurrencySymbol(settings.currencySymbol ?? "₽");
    setDefaultLanguage((settings.defaultLanguage as Lang) ?? "ru");
    setTableStyle(settings.tableStyle ?? "plain");
    setTableStripeColor(settings.tableStripeColor ?? "");
    setTableHeaderColor(settings.tableHeaderColor ?? "");
    setTableBorderColor(settings.tableBorderColor ?? "");
    if (settings.logoObjectPath) {
      setLogoPreview(`/api/storage/branding-logo?v=${encodeURIComponent(settings.updatedAt)}`);
    } else {
      setLogoPreview(null);
    }
  }, [settings]);

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("settings.logoMustBeImage", "Логотип должен быть изображением"), variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      const { path } = await uploadBrandingLogo(file);
      setLogoObjectPath(path);
      setLogoPreview(URL.createObjectURL(file));
      toast({ title: t("settings.logoUploaded", "Логотип загружен. Не забудьте сохранить.") });
    } catch {
      toast({ title: t("settings.logoUploadError", "Не удалось загрузить логотип"), variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    setLogoObjectPath(null);
    setLogoPreview(null);
  };

  const saveBranding = async () => {
    try {
      await updateSettings.mutateAsync({
        data: {
          appNameJson: appNameJson as MultilingualText,
          subtitleJson: subtitleJson as MultilingualText,
          logoObjectPath,
          currencySymbol: currencySymbol.trim() || "₽",
          defaultLanguage,
          tableStyle: tableStyle as "plain" | "striped" | "striped_bold",
          tableStripeColor: tableStripeColor || null,
          tableHeaderColor: tableHeaderColor || null,
          tableBorderColor: tableBorderColor || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: t("settings.brandingSaved", "Настройки сохранены") });
    } catch {
      toast({ title: t("settings.saveError", "Не удалось сохранить"), variant: "destructive" });
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("settings.title", "Настройки")}</h1>
        <p className="text-sm text-slate-500">{t("settings.subtitle", "Управление профилем и платформой")}</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-4 h-4 text-blue-600" />
            {t("settings.profile", "Профиль")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.firstName", "Имя")}</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.lastName", "Фамилия")}</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">{t("settings.email", "Email")}</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">{t("settings.language", "Язык интерфейса")}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "ru" | "en" | "he")}>
              <SelectTrigger className="w-full sm:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ru">Русский</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="he">עברית</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={updateMe.isPending}>
              {updateMe.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("settings.save", "Сохранить")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4 text-blue-600" />
            {t("settings.changePassword", "Смена пароля")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">{t("settings.currentPassword", "Текущий пароль")}</Label>
            <PasswordInput value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.newPassword", "Новый пароль")}</Label>
              <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.confirmPassword", "Подтвердите пароль")}</Label>
              <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={submitPassword}
              disabled={changePassword.isPending || !currentPassword || !newPassword}
            >
              {changePassword.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("settings.changePassword", "Сменить пароль")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Branding (admin only) */}
      {canBranding && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="w-4 h-4 text-blue-600" />
              {t("settings.branding", "Брендинг платформы")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MultilingualInput
              label={t("settings.appName", "Название компании")}
              value={appNameJson}
              onChange={setAppNameJson}
            />
            <MultilingualInput
              label={t("settings.appSubtitle", "Подзаголовок")}
              value={subtitleJson}
              onChange={setSubtitleJson}
            />
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.logo", "Логотип")}</Label>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-lg bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
                  {logoPreview ? (
                    <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
                  ) : (
                    <Building2 className="w-7 h-7 text-white" />
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {t("settings.uploadLogo", "Загрузить")}
                </Button>
                {logoPreview && (
                  <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={removeLogo}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t("settings.removeLogo", "Удалить")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-400">{t("settings.logoHint", "PNG или SVG с прозрачным фоном смотрятся лучше всего.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.currency", "Символ валюты")}</Label>
              <Input
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
                placeholder="₽"
                maxLength={8}
                className="max-w-[140px]"
              />
              <p className="text-xs text-slate-400">{t("settings.currencyHint", "Используется везде, где отображается денежная сумма (например, виджеты дашборда). Например: ₽, $, €, ₸.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.defaultLanguage", "Язык по умолчанию")}</Label>
              <Select value={defaultLanguage} onValueChange={(v) => setDefaultLanguage(v as Lang)}>
                <SelectTrigger className="max-w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">{t("settings.defaultLanguageHint", "Язык интерфейса для новых пользователей и тех, кто ещё не выбрал язык.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.tableStyle", "Стиль таблицы")}</Label>
              <Select value={tableStyle} onValueChange={(v) => setTableStyle(v)}>
                <SelectTrigger className="max-w-[320px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">{t("settings.tableStylePlain", "Обычный (как сейчас)")}</SelectItem>
                  <SelectItem value="striped">{t("settings.tableStyleStriped", "Чередующиеся строки")}</SelectItem>
                  <SelectItem value="striped_bold">{t("settings.tableStyleStripedBold", "Чередующиеся строки + выделенный заголовок")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">{t("settings.tableStyleHint", "Влияет на отображение таблиц с записями во всей платформе.")}</p>
            </div>
            <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-xs text-slate-500">{t("settings.tableColorsHint", "Цвета таблицы записей (необязательно). Если не заданы, используются стандартные серые.")}</p>
              {tableStyle !== "plain" && (
                <ColorPickerControl
                  label={t("settings.tableStripeColor", "Цвет полосок")}
                  value={tableStripeColor}
                  onChange={setTableStripeColor}
                />
              )}
              <ColorPickerControl
                label={t("settings.tableHeaderColor", "Цвет заголовка")}
                value={tableHeaderColor}
                onChange={setTableHeaderColor}
              />
              <ColorPickerControl
                label={t("settings.tableBorderColor", "Цвет линий")}
                value={tableBorderColor}
                onChange={setTableBorderColor}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveBranding} disabled={updateSettings.isPending}>
                {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("settings.save", "Сохранить")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canBranding && <LocalFoldersManager />}
    </div>
  );
}

/**
 * Build a flat, indented list of managed local folders (parents before their
 * children) so a nested folder tree renders as a simple ordered list.
 */
function flattenLocalFolders(folders: LocalFolder[]): { folder: LocalFolder; depth: number }[] {
  const byParent = new Map<number | null, LocalFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const out: { folder: LocalFolder; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Admin screen (inside Настройки сайта) to manage the folders that local file
 * uploads are organized into. The default folder is always present and cannot be
 * removed. Gated by the same "settings" cap that controls the branding card.
 */
function LocalFoldersManager() {
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: folders = [] } = useListLocalFolders();
  const createFolder = useCreateLocalFolder();
  const deleteFolder = useDeleteLocalFolder();
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListLocalFoldersQueryKey() });

  const addFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createFolder.mutateAsync({ data: { name, parentId } });
      setNewName("");
      setParentId(null);
      await invalidate();
      toast({ title: t("localFolders.created", "Папка создана") });
    } catch {
      toast({ title: t("localFolders.createError", "Не удалось создать папку"), variant: "destructive" });
    }
  };

  const removeFolder = async (id: number) => {
    try {
      await deleteFolder.mutateAsync({ id });
      await invalidate();
      toast({ title: t("localFolders.deleted", "Папка удалена") });
    } catch {
      toast({ title: t("localFolders.deleteError", "Не удалось удалить папку"), variant: "destructive" });
    }
  };

  const flat = flattenLocalFolders(folders);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderTree className="w-4 h-4 text-blue-600" />
          {t("localFolders.title", "Папки для файлов")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-400">
          {t(
            "localFolders.hint",
            "Папки, по которым раскладываются загруженные на сервер файлы. Для каждого файлового поля можно выбрать папку.",
          )}
        </p>

        <div className="space-y-1">
          {flat.map(({ folder, depth }) => (
            <div
              key={folder.id}
              className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2"
            >
              <span className="text-sm text-slate-700">
                {depth > 0 ? "\u00A0".repeat(depth * 3) + "└ " : ""}
                {folder.name}
                {folder.isDefault && (
                  <span className="ml-2 text-xs text-slate-400">
                    {t("localFolders.default", "(по умолчанию)")}
                  </span>
                )}
              </span>
              {!folder.isDefault && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-slate-400 hover:text-red-600"
                  onClick={() => removeFolder(folder.id)}
                  disabled={deleteFolder.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div className="flex-1 min-w-[160px] space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {t("localFolders.newName", "Название папки")}
            </Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("localFolders.newNamePlaceholder", "Например, Договоры")}
            />
          </div>
          <div className="min-w-[160px] space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {t("localFolders.parent", "Родительская папка")}
            </Label>
            <Select
              value={parentId != null ? String(parentId) : "__root__"}
              onValueChange={(v) => setParentId(v === "__root__" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">{t("localFolders.parentRoot", "Верхний уровень")}</SelectItem>
                {flat.map(({ folder, depth }) => (
                  <SelectItem key={folder.id} value={String(folder.id)}>
                    {depth > 0 ? "\u00A0".repeat(depth * 3) + "└ " : ""}
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addFolder} disabled={createFolder.isPending || !newName.trim()}>
            {createFolder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("localFolders.add", "Добавить")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
