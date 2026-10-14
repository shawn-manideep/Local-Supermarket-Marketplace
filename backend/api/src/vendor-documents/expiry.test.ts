import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryMilestone, fssaiExpiryInput, fssaiStatus, indiaDate } from "./expiry.js";

test("India calendar day changes at 18:30 UTC, independent of server timezone", () => {
  assert.equal(indiaDate(new Date("2026-10-13T18:29:59Z")), "2026-10-13");
  assert.equal(indiaDate(new Date("2026-10-13T18:30:00Z")), "2026-10-14");
});
test("FSSAI statuses and milestones use real calendar dates including leap day", () => {
  assert.deepEqual(fssaiStatus(null,"2026-10-14"), { expiryDate:null,status:"DATE_REQUIRED",daysRemaining:null });
  for(const [date,status,days] of [
    ["2026-11-14","VALID",31], ["2026-11-13","EXPIRING_SOON",30],
    ["2026-10-21","EXPIRING_SOON",7], ["2026-10-15","EXPIRING_SOON",1],
    ["2026-10-14","EXPIRED",0], ["2026-10-13","EXPIRED",-1],
  ] as const) {
    const actual=fssaiStatus(date,"2026-10-14");
    assert.equal(actual.status,status);assert.equal(actual.daysRemaining,days);
  }
  assert.equal(fssaiStatus("2028-03-01","2028-02-28").daysRemaining,2);
  assert.deepEqual([31,30,8,7,1,0,-2].map(expiryMilestone),[null,"30","30","7","7","0","0"]);
});
test("FSSAI date validation rejects impossible dates and unexpected identity fields", () => {
  assert.ok(fssaiExpiryInput.safeParse({expiryDate:"2028-02-29"}).success);
  for(const expiryDate of ["2026-02-29","2026-04-31","2026-1-1","0000-01-01","text"])
    assert.ok(!fssaiExpiryInput.safeParse({expiryDate}).success);
  assert.ok(!fssaiExpiryInput.safeParse({expiryDate:"2028-02-29",storeId:"other"}).success);
});
