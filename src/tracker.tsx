"use client";
import { usePathname } from "next/navigation.js";
import { useEffect } from "react";
import { entrySource } from "./personalization/stats.js";

export const PERSONALIZATION_EVENT = "utm:personalization";

export type PersonalizationViewDetail = {
  audience: string;
  path: string;
  variant: boolean;
  entry: boolean;
  source?: string;
  medium?: string;
  campaign?: string;
};

type Props = {
  /** Active audience key, or null for default content. */
  audience: string | null;
  /** This page showed content specific to the audience (counted as a personalized view). */
  variant?: boolean;
  /** dataLayer event name, default `utm_personalization`. */
  eventName?: string;
  /** Push to `window.dataLayer` (GTM / GA4), default true. */
  dataLayer?: boolean;
  /**
   * Record the view in the admin statistics (`personalization.stats`).
   * `true` posts to `/api/utm-audiences/stats`; a string is the endpoint URL.
   */
  stats?: boolean | string;
};

// First view of this page load; later client-side navigations are not entries.
let entered = false;

/**
 * One event per page view: `window.dataLayer`, a `utm:personalization`
 * window event for any analytics tool, and optionally the admin statistics.
 * No cookie, no identifier, no third-party request.
 *
 * ```ts
 * window.addEventListener('utm:personalization', (e) =>
 *   track('Personalized view', e.detail)) // e.g. Vercel Analytics
 * ```
 */
export function PersonalizationTracker({
  audience,
  variant = false,
  eventName = "utm_personalization",
  dataLayer = true,
  stats = false,
}: Props) {
  const pathname = usePathname();
  useEffect(() => {
    const origin = entered
      ? { entry: false }
      : entrySource(
          window.location.search,
          document.referrer,
          window.location.host,
        );
    entered = true;
    const detail: PersonalizationViewDetail = {
      audience: audience ?? "default",
      path: pathname || window.location.pathname,
      variant: Boolean(audience && variant),
      ...origin,
    };
    if (dataLayer) {
      const w = window as unknown as { dataLayer?: unknown[] };
      w.dataLayer = w.dataLayer ?? [];
      w.dataLayer.push({
        event: eventName,
        utm_audience: detail.audience,
        utm_variant: detail.variant,
      });
    }
    window.dispatchEvent(
      new CustomEvent<PersonalizationViewDetail>(PERSONALIZATION_EVENT, {
        detail,
      }),
    );
    if (stats) {
      const url =
        typeof stats === "string" ? stats : "/api/utm-audiences/stats";
      const body = JSON.stringify(detail);
      // text/plain beacon: no CORS preflight, survives navigation.
      if (!navigator.sendBeacon?.(url, body))
        void fetch(url, { method: "POST", body, keepalive: true }).catch(
          () => undefined,
        );
    }
  }, [audience, variant, eventName, dataLayer, stats, pathname]);
  return null;
}
