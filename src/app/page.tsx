import { Show, SignIn } from "@clerk/nextjs";
import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <AppShell>
          <main className="flex min-h-0 flex-1 bg-background">
            <ChatPanel />
          </main>
        </AppShell>
      </Show>
      <Show when="signed-out">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4">
          <SignIn routing="hash" />
        </div>
      </Show>
    </>
  );
}
