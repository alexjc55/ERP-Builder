import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateMe,
  useChangePassword,
  useGetSettings,
  useUpdateSettings,
  getGetMeQueryKey,
  getGetSettingsQueryKey,
  type MultilingualText,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { uploadFile } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { Building2, User, Lock, Image as ImageIcon, Loader2, Upload, Trash2 } from "lucide-react";

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
  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  const updateMe = useUpdateMe();
  const saveProfile = async () => {
    try {
      const updated = await updateMe.mutateAsync({
        data: { firstName: firstName.trim(), lastName: lastName.trim() },
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
      const { path } = await uploadFile(file);
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
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.newPassword", "Новый пароль")}</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t("settings.confirmPassword", "Подтвердите пароль")}</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
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
            <div className="flex justify-end">
              <Button onClick={saveBranding} disabled={updateSettings.isPending}>
                {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("settings.save", "Сохранить")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
