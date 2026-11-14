"use client";
import { useEffect } from "react";

type Props = {
  /** Active audience key, or null for default content. */
  audience: string | null;
  /** dataLayer event name, default `utm_personalization`. */
  eventName?: string;
};

/**
 * Pushes one event per page view to `window.dataLayer` (GTM / GA4) so
 * conversions can be compared by audience. Renders nothing, loads no script.
 */
export function PersonalizationTracker({
  audience,
  eventName = "utm_personalization",
}: Props) {
  useEffect(() => {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({
      event: eventName,
      utm_audience: audience ?? "default",
    });
  }, [audience, eventName]);
  return null;
}
