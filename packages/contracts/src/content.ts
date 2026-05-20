import { z } from "zod";

export const R2ObjectBody = z.unknown();
export type R2ObjectBody = z.infer<typeof R2ObjectBody>;
