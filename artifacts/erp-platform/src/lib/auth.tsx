import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  getGetMeQueryKey,
  setAuthTokenGetter,
  impersonate as apiImpersonate,
  stopImpersonation as apiStopImpersonation,
  redeemGuestLink as apiRedeemGuestLink,
} from "@workspace/api-client-react";
import type { UserProfile, RolePermissions, RoleAdminCaps, FieldAccess, FieldPermissions } from "@workspace/api-client-react";

type RecordAction = "view" | "create" | "update" | "delete";

const ACCESS_RANK: Record<FieldAccess, number> = { hidden: 0, view: 1, edit: 2 };
// Most permissive of two access levels (edit > view > hidden). Mirrors the
// server `maxAccess` so client and server resolve multi-role field access the same way.
function maxAccess(a: FieldAccess | null, b: FieldAccess): FieldAccess {
  if (a == null) return b;
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
  permissions: RolePermissions | null;
  isSuperAdmin: boolean;
  canAdmin: (area: keyof RoleAdminCaps) => boolean;
  /**
   * Whether the current user may perform a record action on an entity. Pass the
   * mirror `pageId` when acting through a mirror page so a per-mirror-page
   * override (key `mirror:<pageId>`) is consulted instead of the entity rights.
   */
  canRecord: (entityId: number, action: RecordAction, pageId?: number) => boolean;
  canPage: (pageId: number) => boolean;
  /** Resolve the current user's access to a field; mirrors the server boundary. Pass mirror pageId for a per-mirror-page override. */
  fieldAccess: (field: { permissionsJson?: FieldPermissions | null }, entityId: number, pageId?: number) => FieldAccess;
  /** Start acting as another user (admin only). */
  impersonate: (userId: number) => Promise<void>;
  /** Return to the original admin account. */
  stopImpersonation: () => Promise<void>;
  /** True when the session was opened via a passwordless guest link (read-only). */
  isGuest: boolean;
  /** Exchange a guest link token for a read-only session. */
  redeemGuest: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("erp_token"));
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("erp_token"));
  }, []);

  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    }
  });

  const handleLogin = (newToken: string, _newUser: UserProfile) => {
    localStorage.setItem("erp_token", newToken);
    setToken(newToken);
    refetch();
  };

  const handleLogout = () => {
    localStorage.removeItem("erp_token");
    setToken(null);
  };

  // Switching identity: swap the token and drop all cached data so every query
  // refetches under the new user (different permissions / scoped rows).
  const switchIdentity = async (newToken: string) => {
    localStorage.setItem("erp_token", newToken);
    queryClient.clear();
    setToken(newToken);
    await refetch();
  };

  const handleImpersonate = async (userId: number) => {
    const res = await apiImpersonate({ userId });
    await switchIdentity(res.token);
  };

  const handleStopImpersonation = async () => {
    const res = await apiStopImpersonation();
    await switchIdentity(res.token);
  };

  const handleRedeemGuest = async (guestToken: string) => {
    const res = await apiRedeemGuestLink({ token: guestToken });
    await switchIdentity(res.token);
  };

  const permissions = user?.permissions ?? null;
  const isSuperAdmin = permissions?.superAdmin === true;

  const canAdmin = (area: keyof RoleAdminCaps): boolean =>
    isSuperAdmin || permissions?.admin?.[area] === true;

  // Resolve the effective record perm, preferring a mirror-page override when
  // present. Mirrors the server boundary; the server remains the real boundary.
  const recordPermFor = (entityId: number, pageId?: number) => {
    if (pageId != null) {
      const override = permissions?.records?.[`mirror:${pageId}`];
      if (override) return override;
    }
    return permissions?.records?.[String(entityId)];
  };

  const canRecord = (entityId: number, action: RecordAction, pageId?: number): boolean =>
    isSuperAdmin || recordPermFor(entityId, pageId)?.[action] === true;

  const canPage = (pageId: number): boolean =>
    isSuperAdmin || (permissions?.pageIds?.includes(pageId) ?? false);

  // Most-permissive field access across ALL of the user's roles, mirroring the
  // server `resolveFieldAccess`: an explicit per-field entry wins (most permissive
  // among the roles that have one); otherwise it inherits from record write perms.
  const fieldAccess = (
    field: { permissionsJson?: FieldPermissions | null },
    entityId: number,
    pageId?: number,
  ): FieldAccess => {
    if (isSuperAdmin) return "edit";
    const roleIds =
      user?.roleIds && user.roleIds.length > 0
        ? user.roleIds
        : user?.roleId != null
          ? [user.roleId]
          : [];
    const rp = recordPermFor(entityId, pageId);
    const inherited: FieldAccess = rp?.create || rp?.update ? "edit" : "view";
    const permsJson = field.permissionsJson;
    const explicits = roleIds
      .map((rid) => permsJson?.[String(rid)])
      .filter((v): v is FieldAccess => v != null);
    if (roleIds.length > 0 && explicits.length === roleIds.length) {
      return explicits.reduce<FieldAccess | null>((acc, v) => maxAccess(acc, v), null) ?? inherited;
    }
    if (explicits.length === 0) return inherited;
    const maxExplicit = explicits.reduce<FieldAccess | null>((acc, v) => maxAccess(acc, v), null);
    return maxAccess(maxExplicit, inherited);
  };

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading: isLoading && !!token,
        login: handleLogin,
        logout: handleLogout,
        permissions,
        isSuperAdmin,
        canAdmin,
        canRecord,
        canPage,
        fieldAccess,
        impersonate: handleImpersonate,
        stopImpersonation: handleStopImpersonation,
        isGuest: user?.isGuest === true,
        redeemGuest: handleRedeemGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
