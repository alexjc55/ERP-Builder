import { useAuth } from "@/lib/auth";
import { useListPages } from "@workspace/api-client-react";
import type { Page, MultilingualText } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import {
  Building2, LayoutDashboard, Users, Shield, Layout as LayoutIcon,
  Languages, Settings, LogOut, ChevronDown, ChevronRight,
  Menu, X, Database, Table
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
};

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

function SidebarItem({
  name,
  icon,
  route,
  children,
  depth = 0,
}: {
  name: string;
  icon?: string;
  route?: string;
  children?: React.ReactNode;
  depth?: number;
}) {
  const [location] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!children;
  const isActive = route ? (route === "/" ? location === route : location.startsWith(route)) : false;
  const IconComp = icon ? (ICON_MAP[icon] || LayoutDashboard) : LayoutDashboard;

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
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: pagesData } = useListPages();

  const pages = pagesData || [];
  const topPages = pages.filter((p: Page) => !p.parentPageId && p.isActive);
  const subPages = pages.filter((p: Page) => p.parentPageId && p.isActive);

  const getSubPages = (parentId: number) =>
    subPages.filter((p: Page) => p.parentPageId === parentId).sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);

  const initials = user
    ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "U"
    : "U";

  const Sidebar = (
    <div className="flex flex-col h-full bg-slate-900 w-64 border-r border-slate-700/60">
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700/60">
        <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-white leading-tight">ERP Builder</div>
          <div className="text-xs text-slate-500">Production Platform</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {topPages.sort((a: Page, b: Page) => a.sortOrder - b.sortOrder).map((page: Page) => {
          const name = getML(page.nameJson);
          const children = getSubPages(page.id);

          if (children.length > 0) {
            return (
              <SidebarItem key={page.id} name={name} icon={page.icon || "settings"} depth={0}>
                {children.map((child: Page) => (
                  <SidebarItem
                    key={child.id}
                    name={getML(child.nameJson)}
                    icon={child.icon || "layout"}
                    route={child.path || "/"}
                    depth={1}
                  />
                ))}
              </SidebarItem>
            );
          }

          return (
            <SidebarItem key={page.id} name={name} icon={page.icon || "layout-dashboard"} route={page.path || "/"} depth={0} />
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-700/60">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem disabled>
              <Settings className="w-4 h-4 mr-2" />
              Настройки
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
              <LogOut className="w-4 h-4 mr-2" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <div className="hidden lg:flex shrink-0">{Sidebar}</div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
