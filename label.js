export const LABEL_FONT = '"DM Sans", "Yu Gothic", Meiryo, sans-serif';

// Measure the same wrapped text for the DOM preview and exported canvas.
export function fitLabel(context, text, width, height, maximum = 18) {
  const padding = Math.min(3, width * .08, height * .08);
  const availableWidth = Math.max(.01, width - padding * 2);
  const availableHeight = Math.max(.01, height - padding * 2);
  function measure(size) {
    context.font = `${size}px ${LABEL_FONT}`;
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const character of Array.from(paragraph)) {
        const candidate = line + character;
        if (line && context.measureText(candidate).width > availableWidth) {
          lines.push(line);
          line = character;
        } else line = candidate;
      }
      lines.push(line);
    }
    return { lines, fits: lines.length * size * 1.2 <= availableHeight &&
      lines.every(line => context.measureText(line).width <= availableWidth) };
  }
  let low = 0;
  let high = maximum;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (measure(middle).fits) low = middle;
    else high = middle;
  }
  const size = Math.max(.001, low);
  return { size, lines: measure(size).lines, lineHeight: size * 1.2 };
}
