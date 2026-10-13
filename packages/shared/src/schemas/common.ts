import { z } from "zod";

export const Id = z.string().min(1);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");
export const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:mm");
export const IsoDateTime = z.string().datetime({ offset: true });
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Warna #RRGGBB");
/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export const Weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7);

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
