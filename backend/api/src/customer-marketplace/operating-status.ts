export interface OperatingHourValue {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export function indiaCurrentDayAndTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { dayOfWeek: Math.max(0, days.indexOf(weekday ?? "")), time: `${hour}:${minute}` };
}

export function operatingStatus(hours: OperatingHourValue[], date = new Date()) {
  const current = indiaCurrentDayAndTime(date);
  const today = hours.find((hour) => hour.dayOfWeek === current.dayOfWeek);
  if (!today || today.isClosed || !today.opensAt || !today.closesAt) return "CLOSED" as const;
  return current.time >= today.opensAt.slice(0, 5) && current.time < today.closesAt.slice(0, 5)
    ? "OPEN" as const
    : "CLOSED" as const;
}