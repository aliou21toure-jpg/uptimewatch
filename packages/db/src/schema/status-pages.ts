import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";
import { organizations } from "./organizations";

export const statusPages = pgTable(
  "status_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Public URL: /status/<slug>. Unique across all organizations. */
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("status_pages_org_id_id_unique").on(t.orgId, t.id),
    check("status_pages_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("status_pages_description_length", sql`char_length(${t.description}) <= 1000`),
  ],
);

export const statusPageMonitors = pgTable(
  "status_page_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    statusPageId: uuid("status_page_id").notNull(),
    monitorId: uuid("monitor_id").notNull(),
    /** Public name of the component; the monitor's own name and URL are never shown. */
    displayName: varchar("display_name", { length: 120 }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    // Both foreign keys include org_id: a page can only list monitors of its own organization (spec §5.4).
    foreignKey({ columns: [t.orgId, t.statusPageId], foreignColumns: [statusPages.orgId, statusPages.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.monitorId], foreignColumns: [monitors.orgId, monitors.id] }).onDelete("cascade"),
    unique("status_page_monitors_unique").on(t.statusPageId, t.monitorId),
    index("status_page_monitors_monitor_idx").on(t.monitorId),
  ],
);
