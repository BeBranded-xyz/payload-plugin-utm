import type { CollectionConfig, Field } from "payload";

/** Named fields of a collection, through tabs, rows and collapsibles (not into named groups). */
export function allFields(
  collection: Pick<CollectionConfig, "fields">,
): Field[] {
  const walk = (fields: Field[]): Field[] =>
    fields.flatMap((field) => {
      if (field.type === "tabs")
        return field.tabs.flatMap((tab) => walk(tab.fields));
      if (
        (field.type === "row" || field.type === "collapsible") &&
        "fields" in field
      )
        return walk(field.fields);
      return [field];
    });
  return walk(collection.fields);
}

type Handler = (req: any) => Promise<Response>; // eslint-disable-line
/** A collection endpoint by path (the campaigns collection also has the CSV export). */
export function endpointOf(
  collection: Pick<CollectionConfig, "endpoints">,
  path: string,
): { handler: Handler } {
  const found = (
    (collection.endpoints || []) as { path: string; handler: Handler }[]
  ).find((e) => e.path === path);
  if (!found) throw new Error(`no endpoint ${path}`);
  return found;
}
