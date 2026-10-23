import { pgTable, serial, text, jsonb, integer } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { cardLayoutSchema } from "./card-templates";

export const cardAppearanceSchema = cardLayoutSchema.pick({
  style: true, presentation: true, customStyle: true,
}).strict();
export const cardStylePresetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  appearance: cardAppearanceSchema,
  expectedRevision: z.number().int().positive().optional(),
}).strict();
export const cardStylePresetsTable = pgTable("card_style_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  appearance: jsonb("appearance").$type<z.infer<typeof cardAppearanceSchema>>().notNull(),
  revision: integer("revision").notNull().default(1),
});
