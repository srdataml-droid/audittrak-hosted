import { join } from "node:path";

// Stable after Vercel bundles TypeScript into a Function.
export const publicFile = (relative: string) =>
  join(process.cwd(), "public", relative);
