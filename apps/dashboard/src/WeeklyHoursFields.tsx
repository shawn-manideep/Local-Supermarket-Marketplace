import type { OperatingHour } from "./api";
import { timeInputValue } from "./api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function WeeklyHoursFields({ hours = [], disabled = false }: { hours?: OperatingHour[]; disabled?: boolean }) {
  const byDay = new Map(hours.map((hour) => [hour.dayOfWeek, hour]));
  return <div className="lb-admin-weekly-hours">
    {DAYS.map((day, dayOfWeek) => {
      const existing = byDay.get(dayOfWeek);
      return <div className="lb-admin-hour-line" key={dayOfWeek}>
        <strong>{day}</strong>
        <label><input type="checkbox" name={`hoursOpen_${dayOfWeek}`} defaultChecked={!!existing && !existing.isClosed} disabled={disabled} /> Open</label>
        <input aria-label={`${day} opens at`} type="time" name={`hoursOpensAt_${dayOfWeek}`} defaultValue={timeInputValue(existing?.opensAt ?? null) || "09:00"} disabled={disabled} />
        <span>to</span>
        <input aria-label={`${day} closes at`} type="time" name={`hoursClosesAt_${dayOfWeek}`} defaultValue={timeInputValue(existing?.closesAt ?? null) || "18:00"} disabled={disabled} />
      </div>;
    })}
  </div>;
}

export function readWeeklyHours(form: FormData) {
  return DAYS.map((_day, dayOfWeek) => {
    const isOpen = form.get(`hoursOpen_${dayOfWeek}`) === "on";
    return {
      dayOfWeek,
      isClosed: !isOpen,
      opensAt: isOpen ? String(form.get(`hoursOpensAt_${dayOfWeek}`) || "09:00") : null,
      closesAt: isOpen ? String(form.get(`hoursClosesAt_${dayOfWeek}`) || "18:00") : null,
    };
  });
}
