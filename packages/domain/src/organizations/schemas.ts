import { z } from "zod";

export const organizationNameSchema = z.string().trim().min(2).max(120);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens only");

export const createOrganizationInput = z.object({
  name: organizationNameSchema,
  slug: slugSchema.optional(),
});

export const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);

export const createInvitationInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  role: z.enum(["admin", "member", "viewer"]),
});

export const updateMemberRoleInput = z.object({ role: roleSchema });

export const acceptInvitationInput = z.object({ token: z.string().min(20).max(200) });

export type CreateOrganizationInput = z.input<typeof createOrganizationInput>;
export type CreateInvitationInput = z.input<typeof createInvitationInput>;

/** Turns a display name into a URL slug candidate ("Acme Corp!" -> "acme-corp"). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `org-${slug || "new"}`.replace(/-+$/g, "");
}
