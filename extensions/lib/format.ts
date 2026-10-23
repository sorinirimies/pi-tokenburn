/** Number and cost formatting. */

export function formatNum(n: number): string {
	if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
	return n.toString();
}

export function formatCost(c: number): string {
	return `$${c.toFixed(2)}`;
}
