import { z } from "zod";
import { storeUpdateSchema, operatingHoursSchema, usernameSchema, partnerProvisionSchema, partnerLoginSchema } from "./index.js";

const hourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean(),
  opensAt: z.string().nullable().optional(),
  closesAt: z.string().nullable().optional(),
}).strict().superRefine(({ dayOfWeek: _day, ...hour }, ctx) => {
  const result = operatingHoursSchema.safeParse(hour);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue);
});
const hoursSchema = z.array(hourSchema).max(7).refine(hours => new Set(hours.map(h => h.dayOfWeek)).size === hours.length, "Each day may appear only once");
export const vendorProfileUpdateSchema = storeUpdateSchema.extend({ hours: hoursSchema.optional() }).strict()
  .refine(value => Object.keys(value).length > 0, "At least one permitted profile field is required");
export const vendorProvisionSchema = storeUpdateSchema.extend({
  username: usernameSchema,
  password: partnerProvisionSchema.shape.password,
  name: storeUpdateSchema.shape.name.unwrap(),
  ownerName: storeUpdateSchema.shape.ownerName.unwrap(),
  addressLine1: storeUpdateSchema.shape.addressLine1.unwrap(),
  locality: storeUpdateSchema.shape.locality.unwrap(),
  city: storeUpdateSchema.shape.city.unwrap(),
  state: storeUpdateSchema.shape.state.unwrap(),
  pincode: storeUpdateSchema.shape.pincode.unwrap(),
  hours: hoursSchema.optional(),
}).strict();
export const vendorLoginSchema = partnerLoginSchema;
