import { useEffect, useMemo, useState } from "react";
import {
  useCreateUserFromField,
  useListRoles,
  getListUserOptionsQueryKey,
  type Role,
  type User,
  type FieldUserInput,
  FieldUserInputLanguage,
  FieldUserInputDirection,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The user-type field id; the server validates creation against its config. */
  fieldId: number;
  /** Roles the new account may be assigned. Empty/unset = all roles. */
  allowedRoleIds?: number[];
  /** Called with the created user after success. */
  onCreated: (user: User) => void;
}

/**
 * True if a role carries any privileged capability (superAdmin or any admin.*
 * cap). Such roles can never be assigned through inline field creation — the
 * server hard-rejects them; this just keeps them out of the dropdown so the UI
 * doesn't offer a choice that would always fail.
 */
function isPrivilegedRole(r: Role): boolean {
  const p = r.permissionsJson;
  if (!p) return false;
  if (p.superAdmin) return true;
  return Object.values(p.admin ?? {}).some(Boolean);
}

/**
 * Standalone "add a new user" dialog used inline from a `user`-type field's
 * value picker (opt-in via the field's `userConfigJson.allowCreate`). The role
 * choices are limited to the field's `allowedRoleIds` (empty = all roles) AND to
 * non-privileged roles, and creation goes through a dedicated server endpoint
 * that re-checks those boundaries (record-edit rights + allowed roles +
 * non-privileged) as a hard guard. On success it invalidates the user-options
 * query (so the new user appears in pickers) and hands the created user back to
 * the caller for immediate selection.
 */
export function CreateUserDialog({
  open,
  onOpenChange,
  fieldId,
  allowedRoleIds,
  onCreated,
}: CreateUserDialogProps) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allRoles = [] } = useListRoles();
  const roles: Role[] = useMemo(() => {
    let list = allRoles.filter((r) => !isPrivilegedRole(r));
    if (Array.isArray(allowedRoleIds) && allowedRoleIds.length > 0) {
      const allowed = new Set(allowedRoleIds);
      list = list.filter((r) => allowed.has(r.id));
    }
    return list;
  }, [allRoles, allowedRoleIds]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(0);
  const [language, setLanguage] = useState<FieldUserInputLanguage>(FieldUserInputLanguage.ru);
  const [direction, setDirection] = useState<FieldUserInputDirection>(FieldUserInputDirection.ltr);

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPassword("");
      setRoleId(0);
      setLanguage(FieldUserInputLanguage.ru);
      setDirection(FieldUserInputDirection.ltr);
    }
  }, [open]);

  const createMutation = useCreateUserFromField({
    mutation: {
      onSuccess: (created: User) => {
        toast({ title: t("users.created", "Пользователь создан") });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        queryClient.invalidateQueries({ queryKey: getListUserOptionsQueryKey() });
        // Notify the caller (selects the new user / commits) before closing, so
        // the picker's dialog-close handler sees a "created" state and does not
        // treat the close as a cancel.
        onCreated(created);
        onOpenChange(false);
      },
      onError: (e: unknown) =>
        toast({
          title: t("users.error", "Ошибка"),
          description: (e as { message?: string })?.message,
          variant: "destructive",
        }),
    },
  });

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast({
        title: t("users.error", "Ошибка"),
        description: t("users.fieldsRequired", "Заполните имя, фамилию и email"),
        variant: "destructive",
      });
      return;
    }
    if (password.length < 6) {
      toast({
        title: t("users.error", "Ошибка"),
        description: t("users.passwordTooShort", "Пароль должен содержать минимум 6 символов"),
        variant: "destructive",
      });
      return;
    }
    if (!roleId) {
      toast({
        title: t("users.error", "Ошибка"),
        description: t("users.roleRequired", "Выберите основную роль"),
        variant: "destructive",
      });
      return;
    }
    const create: FieldUserInput = {
      email: email.trim(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      roleId,
      language,
      direction,
    };
    createMutation.mutate({ fieldId, data: create });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.newTitle", "Новый пользователь")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("users.firstName", "Имя")} *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("users.lastName", "Фамилия")} *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("users.password", "Пароль")} *</Label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("users.primaryRole", "Основная роль")} *</Label>
            {roles.length === 0 ? (
              <p className="text-xs text-slate-400">
                {t("fields.noRoles", "Нет ролей для настройки.")}
              </p>
            ) : (
              <Select value={roleId ? String(roleId) : ""} onValueChange={(v) => setRoleId(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder={t("users.selectRole", "Выберите роль")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {ml(r.nameJson) || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("users.colLanguage", "Язык")}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as FieldUserInputLanguage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">{t("users.langRussian", "Русский")}</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="he">עברית</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("users.direction", "Направление")}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as FieldUserInputDirection)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ltr">LTR</SelectItem>
                  <SelectItem value="rtl">RTL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("users.cancel", "Отмена")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t("users.create", "Создать")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
