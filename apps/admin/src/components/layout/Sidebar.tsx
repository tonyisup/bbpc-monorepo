import Link from "next/link"
import { useRouter } from "next/router"
import { useEffect } from "react"
import {
	LayoutDashboard,
	Mic2,
	Users,
	FileText,
	LogOut,
	Mic,
	Sun,
	Star,
	Tv,
	Music,
	Gamepad2,
	Tag as TagIcon,
	BookOpen,
	ShieldAlert,
	Film,
	List,
	Quote,
	RotateCcw
} from "lucide-react"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { ScrollArea } from "../ui/scroll-area"
import { Separator } from "../ui/separator"
import { useBbpcAdminAuth } from "../auth/BbpcAdminAuthContext"

type SidebarProps = React.HTMLAttributes<HTMLDivElement>

export function Sidebar({ className }: SidebarProps) {
	const router = useRouter()
	const { signOut, user } = useBbpcAdminAuth()
	const isAdmin = user?.isAdmin === true
	const recordingAppUrl = process.env.NEXT_PUBLIC_BBPC_RECORDING_URL

	const pathname = router.pathname

	const adminSections = [
		{
			title: "Main",
			routes: [
				{
					label: "Quotabunga",
					icon: Quote,
					href: "/quotabunga",
					active: pathname.startsWith("/quotabunga"),
				},
				{
					label: "Dashboard",
					icon: LayoutDashboard,
					href: "/",
					active: pathname === "/",
				},
				{
					label: "Up Next",
					icon: Mic2,
					href: "/record",
					active: pathname === "/record",
				},
				{
					label: "Recording Room",
					icon: Mic,
					href: recordingAppUrl ?? "/record",
					active: false,
				}
			]
		},
		{
			title: "Content",
			routes: [
				{
					label: "Episodes",
					icon: Mic,
					href: "/episode",
					active: pathname.startsWith("/episode"),
				},
				{
					label: "Shows",
					icon: Tv,
					href: "/show",
					active: pathname.startsWith("/show"),
				},
				{
					label: "Movies",
					icon: Film,
					href: "/movie",
					active: pathname.startsWith("/movie"),
				},
				{
					label: "Bangers",
					icon: Music,
					href: "/banger",
					active: pathname.startsWith("/banger"),
				},
				{
					label: "Reviews",
					icon: Star,
					href: "/review",
					active: pathname.startsWith("/review"),
				},
				{
					label: "Global Syllabus",
					icon: BookOpen,
					href: "/syllabus",
					active: pathname.startsWith("/syllabus"),
				}
			]
		},
		{
			title: "Community",
			routes: [
				{
					label: "Users",
					icon: Users,
					href: "/user",
					active: pathname.startsWith("/user"),
				},
				{
					label: "Roles",
					icon: ShieldAlert,
					href: "/role",
					active: pathname.startsWith("/role"),
				},
				{
					label: "Tags & Votes",
					icon: TagIcon,
					href: "/tag",
					active: pathname.startsWith("/tag"),
				}
			]
		},
		{
			title: "System",
			routes: [
				{
					label: "Seasons",
					icon: Mic,
					href: "/season",
					active: pathname.startsWith("/season"),
				},
				{
					label: "Game Mechanics",
					icon: Gamepad2,
					href: "/game",
					active: pathname.startsWith("/game"),
				},
				{
					label: "Ratings Setup",
					icon: Star,
					href: "/rating",
					active: pathname.startsWith("/rating"),
				},
				{
					label: "Lists",
					icon: List,
					href: "/lists",
					active: pathname.startsWith("/lists"),
				},
				{
					label: "Ranked List Types",
					icon: List,
					href: "/admin/ranked-types",
					active: pathname === "/admin/ranked-types",
				},
				{
					label: "External Cleanup",
					icon: RotateCcw,
					href: "/admin/side-effects",
					active: pathname === "/admin/side-effects",
				}
			]
		},
		{
			title: "Development",
			routes: [
				{
					label: "About",
					icon: FileText,
					href: "/about",
					active: pathname === "/about",
				}
			]
		}
	]
	const sections = isAdmin
		? adminSections
		: [
			{
				title: "Member Tools",
				routes: [
					{
						label: "Ranked Lists",
						icon: List,
						href: "/lists",
						active: pathname.startsWith("/lists"),
					},
					{
						label: "Recording Room",
						icon: Mic2,
						href: recordingAppUrl ?? "/record?guest=true",
						active: pathname === "/record",
					},
				],
			},
		]
	const visibleSections = sections

	useEffect(() => {
		const isDark = localStorage.getItem("theme") === "dark" ||
			(!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches)

		if (isDark) {
			document.documentElement.classList.add("dark")
		} else {
			document.documentElement.classList.remove("dark")
		}
	}, [])

	function toggleTheme(): void {
		const isDark = document.documentElement.classList.toggle("dark")
		localStorage.setItem("theme", isDark ? "dark" : "light")
	}

	return (
		<div className={cn("pb-12 h-screen border-r bg-card", className)}>
			<div className="space-y-4 py-4 h-full flex flex-col">
				<div className="px-4 py-2">
					<h2 className="mb-1 px-2 text-xl font-bold tracking-tight text-primary">
						BBPC Admin
					</h2>
					<p className="px-2 text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
						Podcast Management Console
					</p>
				</div>
				<Separator />
				<ScrollArea className="flex-1 px-3">
					<div className="space-y-6 py-2">
						{visibleSections.map((section) => (
							<div key={section.title} className="space-y-1">
								<h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
									{section.title}
								</h3>
								<div className="space-y-1">
									{section.routes.map((route) => (
										<Link key={route.href} href={route.href}>
											<Button
												variant={route.active ? "secondary" : "ghost"}
												className={cn(
													"w-full justify-start h-9 px-2",
													route.active ? "font-bold bg-secondary" : "hover:bg-muted"
												)}
											>
												<route.icon className={cn("mr-2 h-4 w-4", route.active ? "text-primary" : "text-muted-foreground")} />
												<span className="text-sm">{route.label}</span>
											</Button>
										</Link>
									))}
								</div>
							</div>
						))}
					</div>
				</ScrollArea>

				<div className="mt-auto p-4 space-y-4">
					<Separator />
					{user && (
						<div className="flex items-center gap-3 px-2 py-1">
							<Avatar className="h-8 w-8 border">
								<AvatarImage src={user.image || ""} />
								<AvatarFallback>{user.name?.charAt(0) || "U"}</AvatarFallback>
							</Avatar>
							<div className="flex flex-col min-w-0">
								<span className="text-xs font-bold truncate">{user.name}</span>
								<span className="text-[10px] text-muted-foreground truncate">{user.email}</span>
							</div>
						</div>
					)}
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							className="flex-1 justify-start h-8 text-[10px] font-bold uppercase tracking-tight"
							onClick={() => signOut()}
						>
							<LogOut className="mr-2 h-3.5 w-3.5" />
							Sign Out
						</Button>

						<Button
							size="icon"
							variant="outline"
							className="h-8 w-8"
							onClick={() => toggleTheme()}
						>
							<Sun className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
