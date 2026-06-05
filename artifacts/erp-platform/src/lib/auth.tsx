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

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
  permissions: RolePermissions | null;
  isSuperAdmin: boolean;
  canAdmin: (area: keyof RoleAdminCaps) => boolean;
  canRecord: (entityId: number, action: RecordAction) => boolean;
  canPage: (pageId: number) => boolean;
  /** Resolve the current user's access to a field; mirrors the server boundary. */
  fieldAccess: (field: { permissionsJson?: FieldPermissions | null }, entityId: number) => FieldAccess;
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

  const canRecord = (entityId: number, action: RecordAction): boolean =>
    isSuperAdmin || permissions?.records?.[String(entityId)]?.[action] === true;

  const canPage = (pageId: number): boolean =>
    isSuperAdmin || (permissions?.pageIds?.includes(pageId) ?? false);

  const fieldAccess = (
    field: { permissionsJson?: FieldPermissions | null },
    entityId: number,
  ): FieldAccess => {
    if (isSuperAdmin) return "edit";
    const roleId = user?.roleId;
    const explicit = roleId != null ? field.permissionsJson?.[String(roleId)] : undefined;
    if (explicit) return explicit;
    const rp = permissions?.records?.[String(entityId)];
    return rp?.create || rp?.update ? "edit" : "view";
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
