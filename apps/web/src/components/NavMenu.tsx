"use client";

import { useEffect, useState, type FC } from "react";
import Link from "next/link";
import {
  HomeIcon,
  HistoryIcon,
  GamepadIcon,
  UserIcon,
  ShirtIcon,
  LogIn,
  LogOut,
  BookOpenIcon,
  CalendarIcon,
  Menu,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuTrigger,
  NavigationMenuContent,
} from "@/components/ui/navigation-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConvexImpersonationControl } from "./ConvexImpersonationControl";
import { cn } from "@/lib/utils";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  requiresAuth?: boolean;
  external?: boolean;
}

const publicNavItems: NavItem[] = [
  { href: "/", label: "Home", icon: <HomeIcon className="h-4 w-4" /> },
  {
    href: "/history",
    label: "History",
    icon: <HistoryIcon className="h-4 w-4" />,
  },
  { href: "/game", label: "Game", icon: <GamepadIcon className="h-4 w-4" /> },
  { href: "/year", label: "Year", icon: <CalendarIcon className="h-4 w-4" /> },
  {
    href: "https://www.teepublic.com/user/badboyspodcast",
    label: "Merch",
    icon: <ShirtIcon className="h-4 w-4" />,
    external: true,
  },
  { href: "/about", label: "About", icon: <UserIcon className="h-4 w-4" /> },
];

const authNavItems: NavItem[] = [
  {
    href: "/syllabus",
    label: "Syllabus",
    icon: <BookOpenIcon className="h-4 w-4" />,
    requiresAuth: true,
  },
  {
    href: "/profile",
    label: "Profile",
    icon: <UserIcon className="h-4 w-4" />,
    requiresAuth: true,
  },
];

const NavMenu: FC = () => {
  const { signIn, signOut, user } = useBbpcAuth();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const visibleUser = mounted ? user : null;
  const isLoggedIn = visibleUser !== null;
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  const desktopItems = [
    ...publicNavItems,
    ...authNavItems.filter((item) => !item.requiresAuth || isLoggedIn),
  ];

  return (
    <div className="flex items-center gap-2">
      <ConvexImpersonationControl />

      {/* Desktop horizontal nav */}
      <nav
        className="hidden items-center gap-1 whitespace-nowrap xl:flex"
        aria-label="Main navigation"
      >
        {desktopItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            target={item.external ? "_blank" : undefined}
            rel={item.external ? "noreferrer noopener" : undefined}
            aria-current={
              !item.external && isActive(item.href) ? "page" : undefined
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              !item.external && isActive(item.href)
                ? "bg-red-500/10 text-red-300"
                : "text-zinc-300"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
        {isLoggedIn ? (
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={signIn}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-red-400"
          >
            <LogIn className="h-4 w-4" />
            <span>Sign in</span>
          </button>
        )}
      </nav>

      {/* Mobile dropdown nav */}
      <div className="xl:hidden">
        <NavigationMenu orientation="vertical" delayDuration={0}>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger aria-label="Open navigation menu">
                {visibleUser ? (
                  <Avatar>
                    <AvatarImage src={visibleUser.image ?? undefined} />
                    <AvatarFallback>
                      {visibleUser.name?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Menu className="h-5 w-5" aria-hidden="true" />
                )}
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                {publicNavItems.map((item) => (
                  <NavigationMenuLink key={item.label} asChild>
                    <Link
                      href={item.href}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noreferrer noopener" : undefined}
                      aria-current={
                        !item.external && isActive(item.href)
                          ? "page"
                          : undefined
                      }
                      className={cn(
                        "flex items-center gap-2 px-4 py-3 transition hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                        !item.external &&
                          isActive(item.href) &&
                          "bg-red-500/10 text-red-300"
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </NavigationMenuLink>
                ))}
                {authNavItems
                  .filter((item) => !item.requiresAuth || isLoggedIn)
                  .map((item) => (
                    <NavigationMenuLink key={item.label} asChild>
                      <Link
                        href={item.href}
                        aria-current={isActive(item.href) ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 transition hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                          isActive(item.href) && "bg-red-500/10 text-red-300"
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </Link>
                    </NavigationMenuLink>
                  ))}
                {isLoggedIn ? (
                  <NavigationMenuLink asChild>
                    <button
                      onClick={signOut}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left transition hover:text-red-400"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </NavigationMenuLink>
                ) : (
                  <NavigationMenuLink asChild>
                    <button
                      type="button"
                      onClick={signIn}
                      className="flex items-center gap-2 px-4 py-2 transition hover:text-red-400"
                    >
                      <LogIn className="h-4 w-4" />
                      Sign in
                    </button>
                  </NavigationMenuLink>
                )}
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </div>
  );
};

export default NavMenu;
