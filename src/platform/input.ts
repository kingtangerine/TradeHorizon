// How the person is pointing at the app: a finger on a phone or tablet, or a mouse. Used to choose wording and to
// avoid opening the on-screen keyboard uninvited; layout itself is decided by CSS media queries.

/** True where the main pointer is a finger (phones and tablets), false with a mouse or trackpad. */
export function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/**
 * Rewords a mouse-and-keyboard hint for touch: "Click" becomes "Tap", and sentences about holding a keyboard key
 * (there is none on a phone) are dropped.
 */
export function touchHint(hint: string): string {
  return hint
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/\b(Shift|Ctrl|Alt)\b/.test(sentence))
    .join(' ')
    .replace(/\bClick\b/g, 'Tap')
    .replace(/\bclick\b/g, 'tap')
}
