import config from "@payload-config";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { getPayload } from "payload";
import { getAudienceContent } from "payload-plugin-utm";
import {
  fillAudienceTokens,
  filterPersonalizedBlocks,
  getActiveAudience,
} from "payload-plugin-utm/next";
import { Personalized, SourceMemoryFields } from "payload-plugin-utm/react";
import { PersonalizationTracker } from "payload-plugin-utm/tracker";

type Block = {
  id?: string;
  blockType: string;
  title?: string;
  text?: string;
  label?: string;
  personalization?: { mode?: string };
};

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const segments = (await params).slug ?? [];
  const locale = segments[0] === "en" ? "en" : "fr";
  const slug = (locale === "en" ? segments.slice(1) : segments).join("/") || "home";
  const { isEnabled: draft } = await draftMode();
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: "pages",
    where: { slug: { equals: slug } },
    locale,
    draft,
    depth: 1,
    limit: 1,
  });
  const page = result.docs[0] as { title?: string; layout?: Block[] } | undefined;
  if (!page) notFound();

  const audience = await getActiveAudience();
  const content = await getAudienceContent(payload, audience, { locale });
  const blocks = filterPersonalizedBlocks((page.layout ?? []) as Block[], audience).map(
    (block) => fillAudienceTokens(block, content),
  );
  const variant = blocks.some((block) => block.personalization?.mode && block.personalization.mode !== "all");

  return (
    <main>
      {draft && <p style={{ background: "#fde68a", padding: 8 }}>Mode brouillon</p>}
      <Personalized only="coudac">
        <p data-testid="badge" style={{ display: "inline-block", border: "1px solid", borderRadius: 99, padding: "2px 10px" }}>
          Recommandé par {String(content?.displayName ?? "un partenaire")}
        </p>
      </Personalized>
      <h1>{page.title}</h1>
      {blocks.map((block, index) =>
        block.blockType === "hero" ? (
          <section key={block.id ?? index} data-testid="hero">
            <h2>{block.title}</h2>
            <p>{block.text}</p>
          </section>
        ) : (
          <button key={block.id ?? index} type="button">{block.label}</button>
        ),
      )}
      <form style={{ marginTop: 32 }} data-testid="lead-form">
        <SourceMemoryFields />
        <input name="email" placeholder="email" />
      </form>
      <p style={{ color: "#666", fontSize: 12 }} data-testid="audience">
        audience: {audience?.key ?? "default"} · locale: {locale}
      </p>
      <PersonalizationTracker audience={audience?.key ?? null} variant={variant} stats />
    </main>
  );
}
