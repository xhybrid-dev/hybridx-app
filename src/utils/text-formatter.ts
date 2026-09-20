// src/utils/text-formatter.ts

/**
 * Formats text with proper line breaks and bullet points
 * Handles common bullet point formats: -, •, *, numbers
 * Also splits on inline bullet symbols (•, -, *) when they appear mid-text
 */
export function formatTextWithBullets(text: string): string[] {
  if (!text) return [];

  // First, split by actual line breaks
  const lines = text.split(/\n|\\n/);

  // Then, split each line by inline bullet symbols (• - *)
  // but preserve bullets at the start of lines
  const processedLines: string[] = [];

  lines.forEach(line => {
    // If line starts with a bullet, keep it as is and split the rest
    const startsWithBullet = /^[-•*]\s/.test(line.trim());

    if (startsWithBullet) {
      // Split on subsequent bullets in the same line
      const parts = line.split(/\s+•\s+/);
      parts.forEach((part, index) => {
        if (index === 0) {
          processedLines.push(part.trim());
        } else {
          processedLines.push('• ' + part.trim());
        }
      });
    } else {
      // Split on bullets anywhere in the line
      const parts = line.split(/\s+•\s+/);
      parts.forEach((part, index) => {
        if (index === 0 && part.trim()) {
          processedLines.push(part.trim());
        } else if (part.trim()) {
          processedLines.push('• ' + part.trim());
        }
      });
    }
  });

  return processedLines.filter(line => line.length > 0);
}

/**
 * Checks if a line is a bullet point
 */
export function isBulletPoint(line: string): boolean {
  return /^[-•*\d+.)\]]\s/.test(line.trim());
}

/**
 * Removes bullet point prefix from a line
 */
export function removeBulletPrefix(line: string): string {
  return line.replace(/^[-•*\d+.)\]]\s*/, '').trim();
}

/**
 * Formats exercise details for display
 */
export function formatExerciseDetails(details: string): {
  type: 'bullet' | 'text';
  content: string;
}[] {
  const lines = formatTextWithBullets(details);

  return lines.map(line => ({
    type: isBulletPoint(line) ? 'bullet' as const : 'text' as const,
    content: isBulletPoint(line) ? removeBulletPrefix(line) : line,
  }));
}
