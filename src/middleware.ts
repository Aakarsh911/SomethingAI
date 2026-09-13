import { clerkMiddleware } from "@clerk/nextjs/server";

// Pages only. An anonymous visitor gets bounced to the sign-in screen.
//
// The /api/mcp routes are deliberately not protected here. `auth.protect()`
// answers an unauthenticated API request with an HTML 404, which is a poor
// response for a JSON endpoint and indistinguishable from a genuine missing
// route. Each handler instead resolves the session itself and returns a JSON
// 401, or for the browser-navigated connect routes, a redirect to /sign-in.
const PROTECTED_PREFIXES = ["/settings", "/workflows"];

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;
  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", request.url).toString(),
    });
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
