import { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import type { UserProfile, RolePermissions, RoleAdminCaps, RecordPermission } from "@workspace/api-client-react";

type RecordAction = keyof RecordPermission;

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("erp_token"));

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

  useEffect(() => {
    if (user?.direction === "rtl") {
      document.documentElement.dir = "rtl";
    } else {
      document.documentElement.dir = "ltr";
    }
  }, [user?.direction]);

  const permissions = user?.permissions ?? null;
  const isSuperAdmin = permissions?.superAdmin === true;

  const canAdmin = (area: keyof RoleAdminCaps): boolean =>
    isSuperAdmin || permissions?.admin?.[area] === true;

  const canRecord = (entityId: number, action: RecordAction): boolean =>
    isSuperAdmin || permissions?.records?.[String(entityId)]?.[action] === true;

  const canPage = (pageId: number): boolean =>
    isSuperAdmin || (permissions?.pageIds?.includes(pageId) ?? false);

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
