/** Keep the status hue, darkening only when needed for 4.5:1 on white cards. */
export function kanbanTitleColor(color?: string | null): string {
  const hex = color?.trim();
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return "#475569";
  let channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (rgb: number[]) => rgb.reduce((sum, channel, i) => {
    const c = channel / 255;
    return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
  }, 0);
  while (1.05 / (luminance(channels) + 0.05) < 4.5) {
    channels = channels.map(c => Math.floor(c * 0.96));
  }
  return `#${channels.map(c => c.toString(16).padStart(2, "0")).join("")}`;
}