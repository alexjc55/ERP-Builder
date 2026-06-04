import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import Layout from "@/components/layout/Layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import UsersPage from "@/pages/admin/users";
import RolesPage from "@/pages/admin/roles";
import PagesPage from "@/pages/admin/pages";
import EntitiesPage from "@/pages/admin/entities";
import EntityFieldsPage from "@/pages/admin/entity-fields";
import EntityStatusesPage from "@/pages/admin/entity-statuses";
import EntityRelationsPage from "@/pages/admin/entity-relations";
import EntityRecordsPage from "@/pages/admin/entity-records";
import TranslationsPage from "@/pages/admin/translations";
import DynamicPage from "@/pages/dynamic";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

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

      <Route path="/">
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users">
        <ProtectedRoute>
          <UsersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/roles">
        <ProtectedRoute>
          <RolesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/pages">
        <ProtectedRoute>
          <PagesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/fields">
        <ProtectedRoute>
          <EntityFieldsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/statuses">
        <ProtectedRoute>
          <EntityStatusesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/relations">
        <ProtectedRoute>
          <EntityRelationsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities/:entityId/records">
        <ProtectedRoute>
          <EntityRecordsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/entities">
        <ProtectedRoute>
          <EntitiesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/translations">
        <ProtectedRoute>
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
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
