import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function Home() {
  return (
    <AppShell>
      <main className="flex min-h-0 flex-1 bg-background">
        <ChatPanel />
      </main>
    </AppShell>
  );
}
