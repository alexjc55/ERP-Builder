import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import Layout from "@/components/layout/Layout";
import LoginPage from "@/pages/login";
import GuestEntryPage from "@/pages/guest";
import DashboardPage from "@/pages/dashboard";
import UsersPage from "@/pages/admin/users";
import RolesPage from "@/pages/admin/roles";
import PagesPage from "@/pages/admin/pages";
import EntitiesPage from "@/pages/admin/entities";
import EntityFieldsPage from "@/pages/admin/entity-fields";
import EntityStatusesPage from "@/pages/admin/entity-statuses";
import EntityRelationsPage from "@/pages/admin/entity-relations";
import EntityViewsPage from "@/pages/admin/entity-views";
import EntityWorkflowPage from "@/pages/admin/entity-workflow";
import EntityRecordsPage from "@/pages/admin/entity-records";
import TranslationsPage from "@/pages/admin/translations";
import EventsPage from "@/pages/admin/events";
import ModulesPage from "@/pages/admin/modules";
import GoogleDrivePage from "@/pages/admin/google-drive";
import DynamicPage from "@/pages/dynamic";
import SettingsPage from "@/pages/settings";
import { Loader2, ShieldAlert } from "lucide-react";
import type { RoleAdminCaps } from "@workspace/api-client-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function NoAccess() {
  return (
    <div className="p-6">
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">Доступ запрещён</h1>
        <p className="text-sm text-slate-500">
          У вас нет прав для просмотра этого раздела. Обратитесь к администратору.
        </p>
      </div>
    </div>
  );
}

function ProtectedRoute({
  children,
  adminCap,
}: {
  children: React.ReactNode;
  adminCap?: keyof RoleAdminCaps;
}) {
  const { user, isLoading, canAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (adminCap && !canAdmin(adminCap)) {
    return <Layout><NoAccess /></Layout>;
  }

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (user) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      </Route>

      <Route path="/guest/:token">
        {(params) => <GuestEntryPage key={params.token} />}
      </Route>

      <Route path="/">
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute>
          <SettingsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users">
        <ProtectedRoute adminCap="users">
          <UsersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/roles">
        <ProtectedRoute adminCap="roles">
          <RolesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/pages">
        <ProtectedRoute adminCap="pages">
          <PagesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/events">
        <ProtectedRoute adminCap="events">
          <EventsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/modules">
        <ProtectedRoute adminCap="modules">
          <ModulesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/google-drive">
        <ProtectedRoute adminCap="googleDrive">
          <GoogleDrivePage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/fields">
        <ProtectedRoute adminCap="entities">
          <EntityFieldsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/statuses">
        <ProtectedRoute adminCap="entities">
          <EntityStatusesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/relations">
        <ProtectedRoute adminCap="entities">
          <EntityRelationsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/views">
        <ProtectedRoute adminCap="entities">
          <EntityViewsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/workflow">
        <ProtectedRoute adminCap="entities">
          <EntityWorkflowPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/records">
        <ProtectedRoute>
          <EntityRecordsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities">
        <ProtectedRoute adminCap="entities">
          <EntitiesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/translations">
        <ProtectedRoute adminCap="translations">
          <TranslationsPage />
        </ProtectedRoute>
      </Route>

      <Route>
        <ProtectedRoute>
          <DynamicPage />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
