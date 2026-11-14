// Next.js 16: proxy.ts (Next.js 15: middleware.ts exporting `middleware`).
import { createPersonalizationMiddleware } from "../src/next.js";

export const proxy = createPersonalizationMiddleware({
  // Same secret as utmPlugin({ personalization: { manifest: { secret } } }).
  secret: process.env.UTM_MANIFEST_SECRET,
  // Uncomment to keep pages static: one cached route per audience.
  // rewrite: { prefix: "utm-audience" },
});

export const config = {
  matcher: ["/((?!api|admin|_next|.*\\..*).*)"],
};
