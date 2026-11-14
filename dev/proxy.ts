import { createPersonalizationMiddleware } from "payload-plugin-utm/next";

export const proxy = createPersonalizationMiddleware();

export const config = {
  matcher: ["/((?!api|admin|_next|.*\\..*).*)"],
};
