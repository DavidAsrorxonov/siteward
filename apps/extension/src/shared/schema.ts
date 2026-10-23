import z from "zod";

const timestampSchema = z.number().int().nonnegative();

export const savedSiteSchema = z.strictObject({
  id: z.uuidv4(),
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1),
  urls: z.array(z.url()).min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),

  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  passwordChangedAt: timestampSchema.optional(),
  lastUsedAt: timestampSchema.optional(),
});

export type SavedSite = z.infer<typeof savedSiteSchema>;
