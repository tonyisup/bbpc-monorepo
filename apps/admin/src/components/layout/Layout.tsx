import { Menu, PanelLeft, PanelLeftClose } from "lucide-react";
import React, { useState } from "react";

import { useBbpcAdminAuth } from "../auth/BbpcAdminAuthContext";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetTrigger } from "../ui/sheet";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const { accountStatus, status, user } = useBbpcAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (status === "loading" || accountStatus === "resolving") {
    return null;
  }

  if (user === null || accountStatus !== "ready") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-y-0 z-50 hidden w-64 flex-col md:flex">
          <Sidebar />
        </div>
      )}

      {/* Desktop Toggle Button */}
      <div
        className="fixed top-4 z-[60] hidden md:block"
        style={{ left: sidebarOpen ? "272px" : "16px" }}
      >
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="border-2 border-border bg-card shadow-md hover:bg-accent"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Mobile Header */}
      <div className="fixed left-0 right-0 top-0 z-50 flex items-center border-b bg-background p-4 md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <Sidebar className="border-none" />
          </SheetContent>
        </Sheet>
        <span className="ml-4 font-bold">BBPC Admin</span>
      </div>

      <main
        className="flex-1 pt-16 transition-all duration-300 md:pt-0"
        style={{ paddingLeft: sidebarOpen ? "256px" : "0px" }}
      >
        <div className="h-full space-y-6 p-8">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
