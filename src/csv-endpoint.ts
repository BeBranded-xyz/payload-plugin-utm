import type { CollectionSlug, Endpoint, Where } from "payload";
import { csvColumns, utmLinksToCsv } from "./utilities.js";
export function csvEndpoint(slug: string, maxRows: number): Endpoint {
  return {
    path: "/export-csv",
    method: "get",
    handler: async (req) => {
      if (!req.user)
        return Response.json(
          { error: "Authentication required." },
          { status: 401 },
        );
      const rawWhere = req.query?.where;
      if (
        rawWhere !== undefined &&
        (!rawWhere || typeof rawWhere !== "object" || Array.isArray(rawWhere))
      ) {
        return Response.json(
          { error: "Use Payload bracket syntax for the where filter." },
          { status: 400 },
        );
      }
      // Preserve request context, tenant constraints and field-level permissions.
      const result = await req.payload.find({
        collection: slug as CollectionSlug,
        req,
        overrideAccess: false,
        depth: 0,
        limit: maxRows + 1,
        sort: "id",
        where: rawWhere as Where | undefined,
        select: Object.fromEntries(csvColumns.map((key) => [key, true])),
      });
      if (result.docs.length > maxRows || result.hasNextPage)
        return Response.json(
          { error: `Export exceeds ${maxRows} rows. Narrow the where filter.` },
          { status: 413 },
        );
      return new Response(utmLinksToCsv(result.docs), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  };
}
