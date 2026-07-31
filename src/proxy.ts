import { clerkMiddleware } from "@clerk/nextjs/server";

// Route handlers under /api/resources and /api/chat each call `auth()` themselves and
// return a JSON 401 when signed out — no `auth.protect()` here, since that redirects to
// Clerk's hosted sign-in page even for fetch-based API calls instead of returning JSON.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/:path*",
    "/(api|trpc)(.*)",
  ],
};
