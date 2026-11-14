// Next.js middleware (rename to proxy.ts on Next 16) for UTM personalization.
import { createPersonalizationMiddleware } from "../src/next.js";

export const middleware = createPersonalizationMiddleware({
  // Same secret as utmPlugin({ personalization: { manifest: { secret } } }).
  secret: process.env.UTM_MANIFEST_SECRET,
  // Uncomment to keep pages static: one cached route per audience.
  // rewrite: { prefix: "utm-audience" },
});

export const config = {
  matcher: ["/((?!api|admin|_next|.*\\..*).*)"],
};
