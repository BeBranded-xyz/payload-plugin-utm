import { buildConfig, type Config } from "payload";
import { utmPlugin } from "../src/index.js";

/** Supply your normal app config, including its database adapter and auth collection. */
export function addCampaignLinks(config: Config) {
  return buildConfig({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      utmPlugin({
        presets: [
          { label: "Newsletter", source: "newsletter", medium: "email" },
          {
            label: "Instagram story",
            source: "instagram",
            medium: "social",
            content: "story",
          },
        ],
      }),
    ],
  });
}
