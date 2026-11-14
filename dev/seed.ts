import type { Payload } from "payload";

/** Idempotent demo data: a user, a Coudac audience, a home page with variants, one UTM link. */
export async function seed(payload: Payload) {
  const users = await payload.count({ collection: "users" });
  if (users.totalDocs > 0) return;
  payload.logger.info("Seeding demo data…");
  await payload.create({
    collection: "users",
    data: { email: "dev@example.com", password: "test" } as never,
  });
  const coudac = await payload.create({
    collection: "utm-audiences" as never,
    data: {
      title: "Visiteurs Coudac",
      key: "coudac",
      match: "any",
      priority: 0,
      state: "active",
      conditions: [
        { parameter: "referrer", operator: "equals", value: "coudac.com" },
        { parameter: "utm_source", operator: "equals", value: "coudac" },
      ],
      content: { displayName: "Coudac", tagline: "Agence e-commerce partenaire" },
    } as never,
  });
  const only = { mode: "only", audiences: [coudac.id] };
  const except = { mode: "except", audiences: [coudac.id] };
  await payload.create({
    collection: "pages",
    locale: "fr",
    data: {
      title: "Accueil",
      slug: "home",
      _status: "published",
      layout: [
        { blockType: "hero", title: "Des sites qui convertissent", text: "Pour toutes les marques.", personalization: except },
        { blockType: "hero", title: "Bienvenue aux clients {{audience.displayName|partenaires}}", text: "Nos cas e-commerce : {{audience.tagline}}", personalization: only },
        { blockType: "cta", label: "Prendre rendez-vous", personalization: { mode: "all" } },
      ],
    } as never,
  });
  await payload.create({
    collection: "pages",
    locale: "fr",
    data: { title: "À propos", slug: "about", _status: "published", layout: [{ blockType: "cta", label: "Nous contacter", personalization: { mode: "all" } }] } as never,
  });
  await payload.create({
    collection: "utm-links" as never,
    data: {
      title: "Newsletter novembre",
      destination: "http://localhost:3000/",
      source: "newsletter",
      medium: "email",
      campaign: "novembre",
    } as never,
  });
}
