import { ChartColumn,
  Check, ChevronRight, ChevronsUpDown, GitMerge, Home, LayoutGrid, LogOut, Menu, Monitor, Moon, Scale, Settings, Sun, UserCog,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { ak } from "@/api/keys";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ActivityIndicator } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCan, useGuild, useGuilds } from "@/guild/GuildProvider";
import { cn } from "@/lib/utils";
import { type Theme, useTheme } from "@/theme";
import { CommandPalette } from "./CommandPalette";
import { PageTitleProvider, usePageTitleValue } from "./pageTitle";
import { SECTIONS } from "./sections";

const navItem = (active: boolean) =>
  cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground/80 transition-colors",
    "hover:bg-sidebar-accent hover:text-sidebar-foreground",
    active && "bg-sidebar-accent text-sidebar-foreground",
  );

/** Pending invitations to other guilds, for the switcher's badge. */
function usePendingInvites(): number {
  const { data = [] } = useQuery({ queryKey: ak("invitations"), queryFn: () => api.get<unknown[]>("/invitations") });
  return data.length;
}

function GuildSwitcher() {
  const guild = useGuild();
  const invites = usePendingInvites();
  const { data: guilds = [] } = useGuilds();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-between px-2.5 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              {guild.name.slice(0, 1).toUpperCase()}
              {invites > 0 && (
                <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-destructive ring-2 ring-sidebar"
                      aria-label={`${invites} pending invitation${invites === 1 ? "" : "s"}`} />
              )}
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold">{guild.name}</span>
              <span className="block truncate text-xs text-muted-foreground capitalize">
                {guild.role.replace(/_/g, " ")}
              </span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Guilds</DropdownMenuLabel>
        {guilds.map((g) => (
          <DropdownMenuItem key={g.id} onSelect={() => navigate(`/g/${g.id}`)}>
            <span className="truncate">{g.name}</span>
            {g.id === guild.id && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/guilds")}>
          <LayoutGrid className="size-4" /> All guilds
          {invites > 0 && (
            <span className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {invites} invite{invites === 1 ? "" : "s"}
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THEMES: [Theme, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Monitor]];

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { me, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn("h-auto justify-start gap-2.5 px-2.5 py-2", !compact && "w-full")}>
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
            {me?.username.slice(0, 2)}
          </span>
          {!compact && <span className="truncate text-sm">{me?.username}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        {THEMES.map(([value, label, Icon]) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon className="size-4" /> {label}
            {theme === value && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/account")}>
          <Settings className="size-4" /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => logout().then(() => navigate("/login"))}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const guild = useGuild();
  const { pathname } = useLocation();
  const canManage = useCan("manage_members");
  const canMerge = useCan("merge_in");
  const base = `/g/${guild.id}`;
  const activeSection = SECTIONS.find((s) => pathname === `${base}/${s.path}` || pathname.startsWith(`${base}/${s.path}/`));

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      <NavLink to={base} end className={({ isActive }) => navItem(isActive)} onClick={onNavigate}>
        <Home className="size-4" /> Home
      </NavLink>
      <p className="mt-4 mb-1 px-2.5 text-xs font-medium text-muted-foreground">Library</p>
      {SECTIONS.map((s) => {
        const open = activeSection === s;
        return (
          <div key={s.path}>
            <NavLink to={`${base}/${s.path}`} className={() => navItem(open)} onClick={onNavigate}>
              <s.icon className="size-4" /> {s.label}
            </NavLink>
            {open && (
              <div className="my-0.5 ml-[1.15rem] flex flex-col gap-0.5 border-l pl-2.5">
                {s.pages.map(([to, label]) => (
                  <NavLink
                    key={to}
                    to={to ? `${base}/${s.path}/${to}` : `${base}/${s.path}`}
                    end={!to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
                        isActive && "font-medium text-foreground",
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="mt-4 mb-1 px-2.5 text-xs font-medium text-muted-foreground">Guild</p>
      <NavLink to={`${base}/compare`} className={({ isActive }) => navItem(isActive)} onClick={onNavigate}>
        <Scale className="size-4" /> Compare rankings
      </NavLink>
      <NavLink to={`${base}/stats`} className={({ isActive }) => navItem(isActive)} onClick={onNavigate}>
        <ChartColumn className="size-4" /> Guild stats
      </NavLink>
      {canManage && (
        <NavLink to={`${base}/members`} className={({ isActive }) => navItem(isActive)} onClick={onNavigate}>
          <UserCog className="size-4" /> Members
        </NavLink>
      )}
      {canMerge && (
        <NavLink to={`${base}/merge`} className={({ isActive }) => navItem(isActive)} onClick={onNavigate}>
          <GitMerge className="size-4" /> Merge a guild in
        </NavLink>
      )}
    </nav>
  );
}

/** The chrome around every page inside a guild: sidebar on desktop, a slide-out
 *  sheet on phones, and a slim top bar with activity and the user menu. */
/** Guild › Section › Page (or the entity a detail page names), which also
 * becomes the browser tab title. */
function Breadcrumbs() {
  const guild = useGuild();
  const { pathname } = useLocation();
  const entity = usePageTitleValue();
  const base = `/g/${guild.id}`;
  const rest = pathname.slice(base.length).split("/").filter(Boolean);
  const crumbs: Array<[label: string, to?: string]> = [[guild.name, base]];

  const section = SECTIONS.find((s) => s.path === rest[0]);
  if (section) {
    crumbs.push([section.label, `${base}/${section.path}`]);
    const sub = rest.slice(1);
    const idAt = sub.findIndex((x) => /^\d+$/.test(x));
    if (idAt === -1) {
      const page = section.pages.find(([to]) => to === (sub[0] ?? ""));
      if (page?.[0]) crumbs.push([page[1]]);
    } else {
      const kind = sub[idAt - 1];
      if (kind === "genres" || kind === "platforms") {
        crumbs.push([kind === "genres" ? "Genres" : "Platforms", `${base}/${section.path}/${kind}`]);
      }
      crumbs.push([entity ?? "…", sub[idAt + 1] ? `${base}/${rest.slice(0, idAt + 2).join("/")}` : undefined]);
      const tail = sub.slice(idAt + 1);
      if (tail[0] === "episodes") crumbs.push(["All episodes", tail[1] ? `${base}/${rest.slice(0, idAt + 3).join("/")}` : undefined]);
      if (tail.at(-1) === "rank") crumbs.push(["Rank"]);
    }
  } else if (rest[0] === "members") {
    crumbs.push(["Members"]);
  } else if (rest[0] === "merge") {
    crumbs.push(["Merge a guild in"]);
  } else if (rest[0] === "compare") {
    crumbs.push(["Compare rankings"]);
  } else if (rest[0] === "stats") {
    crumbs.push(["Guild stats"]);
  } else if (rest[0] === "settings") {
    crumbs.push(["Account settings"]);
  }

  const tab = crumbs.map(([label]) => label).reverse().join(" · ");
  useEffect(() => { document.title = `${tab} · Ranker`; }, [tab]);

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map(([label, to], i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className={cn("flex min-w-0 items-center gap-1", last ? "shrink" : "shrink-0")}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
              {to && !last ? (
                <Link to={to} className="truncate hover:text-foreground">{label}</Link>
              ) : (
                <span className={cn("truncate", last && "font-medium text-foreground")} aria-current={last ? "page" : undefined}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PageTitleProvider>
      <Shell>{children}</Shell>
    </PageTitleProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const guild = useGuild();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="p-2">
          <GuildSwitcher />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <SidebarNav />
        </div>
        <div className="border-t p-2">
          <UserMenu />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/85 px-3 backdrop-blur md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-2">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <GuildSwitcher />
              <div className="mt-2 overflow-y-auto">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Link to={`/g/${guild.id}`} className="truncate text-sm font-semibold md:hidden">{guild.name}</Link>
          <Breadcrumbs />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ActivityIndicator />
            <CommandPalette />
            <div className="md:hidden">
              <UserMenu compact />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
