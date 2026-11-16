import { withPayload } from "@payloadcms/next/withPayload";

/** @type {import('next').NextConfig} */
const nextConfig = { agentRules: false, allowedDevOrigins: ["127.0.0.1"] };

export default withPayload(nextConfig);
