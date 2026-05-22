import { z } from "zod";

export const nicheSchema = z.object({
  name: z
    .string()
    .min(3, "Tên phải có ít nhất 3 ký tự")
    .max(100, "Tên không được quá 100 ký tự"),
  slug: z
    .string()
    .min(2, "Slug phải có ít nhất 2 ký tự")
    .max(100, "Slug không được quá 100 ký tự")
    .regex(/^[a-z0-9-]+$/, "Slug chỉ được có chữ thường, số và dấu gạch ngang"),
  description: z.string().max(500, "Mô tả không quá 500 ký tự").optional(),
  icon: z.string().max(10).optional(),
  targetAudience: z.string().max(300).optional(),
  tone: z.string().max(200).optional(),
  stages: z
    .array(z.string().min(1).max(50))
    .min(1, "Phải có ít nhất 1 stage")
    .default(["ideation", "script", "short", "long"]),
  isActive: z.boolean().default(true),
});

export type NicheFormValues = z.infer<typeof nicheSchema>;

export type NicheFormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<keyof NicheFormValues, string[]>>;
} | null;
