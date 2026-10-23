/** Local-time buckets (hour / day / Monday-week / month / year). */

export type Unit = "day" | "week" | "month" | "year";

/** Local-time start of the day / Monday-week / month containing `ts`. */
export function bucketStart(ts: number, unit: Unit): number {
	const d = new Date(ts);
	if (unit === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	if (unit === "week") {
		const dow = (d.getDay() + 6) % 7; // Monday = 0
		return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
	}
	if (unit === "year") return new Date(d.getFullYear(), 0, 1).getTime();
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function bucketLabel(start: number, unit: Unit): string {
	const d = new Date(start);
	if (unit === "year") return String(d.getFullYear());
	if (unit === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
	const base = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	return unit === "day" ? `${base} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}` : `${base} wk`;
}
