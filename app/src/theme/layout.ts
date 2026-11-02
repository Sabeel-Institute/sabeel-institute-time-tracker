import { useWindowDimensions } from 'react-native';

/**
 * Layout decisions are driven by AVAILABLE WIDTH, not by platform. A phone-first
 * layout opened on a laptop looks amateurish — full-width buttons become bars,
 * card lists are wide empty strips, text strands in whitespace — so the shapes
 * that are right on a phone are made responsive to width here, never to
 * `Platform.OS`. (The sibling kanban app uses the same 700px breakpoint, so the
 * two apps behave alike across sizes.)
 */

/** At/above this width there's room for a multi-column layout: desktop, or a
 *  tablet in landscape. Below it, one column at a time (phones, narrow windows).
 *  Local to this module — width decisions go through `useLayout().isWide`. */
const WIDE_BREAKPOINT = 700;

/** A narrow column for text, forms and detail (~68 chars) so lines stay readable
 *  and fields aren't stretched across a monitor. */
export const READ_MAX_WIDTH = 640;

/** The default mid column for simple pages. */
export const CONTENT_MAX_WIDTH = 840;

/** The cap for card GRIDS — wide enough to lay several cards across a laptop,
 *  capped so an ultra-wide monitor doesn't stretch the grid into one huge row. */
export const LIST_MAX_WIDTH = 1160;

/** The navigation rail's width, on a wide screen; the bottom bar replaces it below
 *  the breakpoint. The same as the sibling LMS's. */
export const RAIL_WIDTH = 76;

export interface Layout {
  width: number;
  height: number;
  /** Room for a multi-column layout: desktop, or a tablet in landscape. */
  isWide: boolean;
  /** One column at a time: phones, and narrow browser windows. */
  isCompact: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  return { width, height, isWide, isCompact: !isWide };
}
