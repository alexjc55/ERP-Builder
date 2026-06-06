import { useAuth } from "@/lib/auth";
import { useML, useT, useLang, LANGS } from "@/lib/i18n";
import { adminCapForPath } from "@/lib/permissions";
import { useListPages } from "@workspace/api-client-react";
import type { Page } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import {
  Building2, LayoutDashboard, Users, Shield, Layout as LayoutIcon,
  Languages, Settings, LogOut, ChevronDown, ChevronRight,
  Menu, X, Database, Table, Check, UserCog, Activity, Puzzle, Eye,
  PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard,
  "users": Users,
  "shield": Shield,
  "layout": LayoutIcon,
  "languages": Languages,
  "settings": Settings,
  "database": Database,
  "table": Table,
  "activity": Activity,
  "puzzle": Puzzle,
};

function SidebarItem({
  name,
  icon,
  route,
  children,
  depth = 0,
  collapsed = false,
}: {
  name: string;
  icon?: string;
  route?: string;
  children?: React.ReactNode;
  depth?: number;
  collapsed?: boolean;
}) {
  const [location] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!children;
  const isActive = route ? (route === "/" ? location === route : location.startsWith(route)) : false;
  const IconComp = icon ? (ICON_MAP[icon] || LayoutDashboard) : LayoutDashboard;

  // Collapsed (icon rail) — groups are flattened by the parent, so here we only
  // ever render leaf links as centered icons with a tooltip.
  if (collapsed) {
    return (
      <Link href={route || "/"}>
        <a
          title={name}
          className={cn(
            "flex items-center justify-center px-0 py-2.5 rounded-lg transition-colors",
            "text-slate-300 hover:bg-slate-700/60 hover:text-white",
            isActive && "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 hover:text-blue-300"
          )}
        >
          <IconComp className={cn("w-5 h-5 shrink-0", isActive ? "text-blue-400" : "text-slate-400")} />
        </a>
      </Link>
    );
  }

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            "text-slate-300 hover:bg-slate-700/60 hover:text-white",
            depth > 0 && "pl-6"
          )}
        >
          <IconComp className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="flex-1 text-left">{name}</span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          )}
        </button>
        {expanded && <div className="mt-0.5 space-y-0.5">{children}</div>}
      </div>
    );
  }

  return (
    <Link href={route || "/"}>
      <a
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          depth === 0
            ? "text-slate-200 hover:bg-slate-700/60 hover:text-white"
            : "text-slate-400 hover:bg-slate-700/60 hover:text-white pl-6",
          isActive && "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 hover:text-blue-300"
        )}
      >
        <IconComp className={cn("w-4 h-4 shrink-0", isActive ? "text-blue-400" : "text-slate-400")} />
        <span>{name}</span>
        {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />}
      </a>
    </Link>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, isSuperAdmin, canAdmin, canPage, stopImpersonation, isGuest } = useAuth();
  const ml = useML();
  const t = useT();
  const { lang, setLang } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleDesktopSidebar = () =>
    setDesktopCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  const { data: pagesData } = useListPages();

  // A page is visible if: superAdmin (all), the home page ("/"), an admin builder
  // page whose capability is granted, or a content page whose id is granted.
  const isPageVisible = (page: Page): boolean => {
    if (isSuperAdmin) return true;
    const path = page.path || "";
    if (path === "/") return true;
    if (path.startsWith("/admin/")) {
      const cap = adminCapForPath(path);
      return cap ? canAdmin(cap) : false;
    }
    return canPage(page.id);
  };

  const pages = pagesData || [];
  const topPages = pages.filter((p: Page) => !p.parentPageId && p.isActive);
  const subPages = pages.filter((p: Page) => p.parentPageId && p.isActive);

  const getSubPages = (parentId: number) =>
    subPages
      .filter((p: Page) => p.parentPageId === parentId)
      .filter(isPageVisible)
      .sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);

  const initials = user
    ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "U"
    : "U";

  const renderSidebar = (collapsed: boolean) => (
    <div
      className={cn(
        "flex flex-col h-full bg-slate-900 border-r border-slate-700/60 transition-all",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-slate-700/60",
          collapsed ? "flex-col gap-2 px-2 py-4" : "gap-3 px-4 py-5"
        )}
      >
        <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-bold text-white leading-tight">ERP Builder</div>
            <div className="text-xs text-slate-500">Production Platform</div>
          </div>
        )}
        <button
          onClick={toggleDesktopSidebar}
          title={collapsed ? t("layout.expandSidebar", "Развернуть меню") : t("layout.collapseSidebar", "Свернуть меню")}
          aria-label={collapsed ? t("layout.expandSidebar", "Развернуть меню") : t("layout.collapseSidebar", "Свернуть меню")}
          className={cn(
            "hidden lg:flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-700/60 hover:text-white shrink-0",
            collapsed ? "w-9 h-7" : "ml-auto w-7 h-7"
          )}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <nav className={cn("flex-1 overflow-y-auto py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {topPages.sort((a: Page, b: Page) => a.sortOrder - b.sortOrder).map((page: Page) => {
          const name = ml(page.nameJson);
          const children = getSubPages(page.id);
          const hasChildPages = subPages.some((p: Page) => p.parentPageId === page.id);

          // Group header: render only if at least one child is visible.
          if (hasChildPages) {
            if (children.length === 0) return null;
            // In the icon rail there is no room for an expandable group, so the
            // group's visible children are flattened into standalone icons.
            if (collapsed) {
              return children.map((child: Page) => (
                <SidebarItem
                  key={child.id}
                  name={ml(child.nameJson)}
                  icon={child.icon || "layout"}
                  route={child.path || "/"}
                  collapsed
                />
              ));
            }
            return (
              <SidebarItem key={page.id} name={name} icon={page.icon || "settings"} depth={0}>
                {children.map((child: Page) => (
                  <SidebarItem
                    key={child.id}
                    name={ml(child.nameJson)}
                    icon={child.icon || "layout"}
                    route={child.path || "/"}
                    depth={1}
                  />
                ))}
              </SidebarItem>
            );
          }

          if (!isPageVisible(page)) return null;
          return (
            <SidebarItem
              key={page.id}
              name={name}
              icon={page.icon || "layout-dashboard"}
              route={page.path || "/"}
              depth={0}
              collapsed={collapsed}
            />
          );
        })}
      </nav>

      <div className={cn("border-t border-slate-700/60", collapsed ? "px-2 py-4 flex justify-center" : "px-3 py-4")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {collapsed ? (
              <button
                title={`${user?.firstName || ""} ${user?.lastName || ""}`.trim()}
                className="flex items-center justify-center p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <Avatar className="w-8 h-8 bg-blue-600">
                  <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            ) : (
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-800 transition-colors">
                <Avatar className="w-8 h-8 bg-blue-600">
                  <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {user?.firstName} {user?.lastName}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{user?.email}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-slate-500">
              <Languages className="w-4 h-4" />
              {t("layout.language", "Язык")}
            </DropdownMenuLabel>
            {LANGS.map((l) => (
              <DropdownMenuItem
                key={l.code}
                onClick={() => setLang(l.code)}
                className="justify-between"
              >
                <span>{l.label}</span>
                {lang === l.code && <Check className="w-4 h-4 text-blue-600" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Settings className="w-4 h-4 mr-2" />
              {t("layout.settings", "Настройки")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
              <LogOut className="w-4 h-4 mr-2" />
              {t("layout.logout", "Выйти")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <div className="hidden lg:flex shrink-0">{renderSidebar(desktopCollapsed)}</div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{renderSidebar(false)}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {isGuest && (
          <div className="flex items-center gap-2 px-4 py-2 bg-sky-100 border-b border-sky-300 text-sm text-sky-900">
            <Eye className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {t("layout.guestMode", "Гостевой доступ — режим только для чтения")}
            </span>
          </div>
        )}
        {user?.impersonator && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-100 border-b border-amber-300 text-sm text-amber-900">
            <span className="flex items-center gap-2 min-w-0">
              <UserCog className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {t("layout.impersonating", "Вы вошли как")}{" "}
                <strong>{user.firstName} {user.lastName}</strong>
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-amber-400 bg-white hover:bg-amber-50"
              onClick={() => { void stopImpersonation(); }}
            >
              {t("layout.stopImpersonation", "Вернуться к")} {user.impersonator.name}
            </Button>
          </div>
        )}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-slate-800">ERP Builder</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
