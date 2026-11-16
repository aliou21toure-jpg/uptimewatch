import "server-only";
import { revalidatePath } from "next/cache";

/** Drops the cached public pages so edits are visible immediately. */
export function revalidateStatusPages(slugs: string[]) {
  for (const slug of slugs) revalidatePath(`/status/${slug}`);
}
