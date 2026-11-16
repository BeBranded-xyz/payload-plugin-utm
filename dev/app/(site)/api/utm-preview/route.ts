import config from "@payload-config";
import { createDraftPreviewRoute } from "payload-plugin-utm/preview";

export const GET = createDraftPreviewRoute({ config });
