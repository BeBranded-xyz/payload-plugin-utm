// A site that already has its own proxy (here: an internal /en locale segment).
// The plugin only decides; the site keeps building its responses.
import { NextResponse, type NextRequest } from "next/server.js";
import { createPersonalizationResolver } from "../src/next.js";

const personalize = createPersonalizationResolver({
  secret: process.env.UTM_MANIFEST_SECRET,
  rewrite: { prefix: "utm-audience" },
});

export async function proxy(request: NextRequest) {
  const decision = await personalize(request);
  if (decision.redirect) return NextResponse.redirect(decision.redirect, 308);
  const init = { request: { headers: decision.requestHeaders } };
  const url = request.nextUrl.clone();
  if (url.pathname === "/fr" || url.pathname.startsWith("/fr/")) {
    if (!decision.variant) return decision.apply(NextResponse.next(init));
    url.pathname = decision.variantPath(url.pathname);
  } else {
    url.pathname = decision.variantPath(
      `/en${url.pathname === "/" ? "" : url.pathname}`,
    );
  }
  return decision.apply(NextResponse.rewrite(url, init));
}

export const config = {
  matcher: ["/((?!api|admin|_next|.*\\..*).*)"],
};
