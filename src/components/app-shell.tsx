"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-80 max-w-[85vw] transition-transform duration-200 ease-out md:static md:z-auto md:w-72 md:max-w-none md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border p-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <MenuIcon />
          </Button>
          <span className="font-heading text-xl font-semibold">Noteboolm</span>
        </div>

        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
