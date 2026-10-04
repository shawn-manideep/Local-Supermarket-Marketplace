/** Bound the existing web flex chain; content remains in its existing ScrollView. */
export const webViewportFlex = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minHeight: 0,
  minWidth: 0,
} as const;

export function customerWebShellBounds(viewportHeight: number) {
  return { ...webViewportFlex, height: viewportHeight, maxHeight: viewportHeight };
}