import { useGetDashboardStats } from "@workspace/api-client-react";
import type { MultilingualText } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Shield, Layout, TrendingUp, Activity } from "lucide-react";

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  isLoading,
}: {
  title: string;
  value?: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  isLoading: boolean;
}) {
  return (
    <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{title}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-3xl font-bold text-slate-800 mt-1">{value ?? 0}</p>
            )}
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: stats, isLoading } = useGetDashboardStats();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Доброе утро";
    if (hour < 18) return "Добрый день";
    return "Добрый вечер";
  };

  const roleDisplay = user?.roleName ? getML(user.roleName) : "—";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          {greeting()}, {user?.firstName}!
        </h1>
        <p className="text-slate-500 mt-1">
          {new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          title="Пользователи"
          value={stats?.totalUsers}
          icon={Users}
          color="bg-blue-600"
          isLoading={isLoading}
        />
        <StatCard
          title="Роли"
          value={stats?.totalRoles}
          icon={Shield}
          color="bg-violet-600"
          isLoading={isLoading}
        />
        <StatCard
          title="Страницы"
          value={stats?.totalPages}
          icon={Layout}
          color="bg-emerald-600"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-700 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              Активность системы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600">Активных пользователей</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-8" />
                ) : (
                  <span className="text-sm font-semibold text-slate-800">{stats?.activeUsers ?? 0}</span>
                )}
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600">Заблокированных пользователей</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-8" />
                ) : (
                  <span className="text-sm font-semibold text-red-500">{stats?.blockedUsers ?? 0}</span>
                )}
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-600">Недавних входов</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-8" />
                ) : (
                  <span className="text-sm font-semibold text-slate-800">{stats?.recentLogins ?? 0}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              Информация о системе
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600">Версия платформы</span>
                <span className="text-sm font-semibold text-slate-800">1.0.0-alpha</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600">Статус базы данных</span>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Активна
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-600">Ваша роль</span>
                <span className="text-sm font-semibold text-blue-600">{roleDisplay}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
