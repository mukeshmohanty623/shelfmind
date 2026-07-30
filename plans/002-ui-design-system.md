# UI Design System: Theming, Brand Color, Mobile Responsiveness

**Status:** done

## Context
Once the PDF indexing pipeline ([[001-pdf-upload-indexing-pipeline]]) was working, the
UI itself needed design passes: dark mode, a real brand color instead of shadcn's
default greyscale, a look inspired by Material Design (explored via an artifact
before committing to code), and a mobile-friendly layout — the original sidebar was a
fixed 288px block with no small-screen behavior, and shadcn's default button/dialog
sizing (32px button height) read as cramped.

## Decisions
- **Dark mode**: toggle-based (not forced), via `next-themes`, default follows system
  preference. Toggle lives in the sidebar header.
- **Light theme palette**: warm cream background instead of pure white (`oklch(0.975
  0.014 85)` family for background/card/muted/border), keeping shadcn's default dark
  theme mostly as-is.
- **Brand color**: primary is `#11b67a` (green) in light mode, `#2fd696` in dark mode
  (brightened so black button labels stay legible on a darker ground). Button/label
  text on all colored surfaces (`primary`, `sidebar-primary`) is pure black
  (`--primary-foreground: #000000`), and general body text (`--foreground`) is pure
  black in light mode. Dark-mode body text stays light — black-on-black isn't
  negotiable regardless of the "black text" ask.
- **Material Design exploration**: prototyped as a standalone HTML artifact
  (shadcn Button vs. an M3-styled restyle — pill shape, flat state-layer overlay,
  ripple, elevation) before touching real code, so the direction could be approved
  cheaply. Verdict: keep shadcn's actual component structure/variants (`default`,
  `secondary`, `outline`, `ghost`, `link`, `destructive`) — only the color tokens
  changed, not the shape system (no pill buttons, no ripple in the real app).
- **Mobile**: sidebar becomes a slide-in drawer below the `md` breakpoint (fixed,
  `-translate-x-full` → `translate-x-0`, backdrop overlay, hamburger toggle in a
  small mobile top bar), and stays static at `md:` and above. Touch targets bumped
  across the board (button default height 32px → 40px, icon buttons 32px → 40px,
  resource list rows more padding, dialog more breathing room).

## Files touched
- `src/app/globals.css` — cream light tokens, primary/ring/sidebar-primary color
  tokens, `.shimmer-text` keyframe (from the original pipeline work)
- `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx` — new
- `src/components/ui/button.tsx` — size scale bumped (`default` h-8→h-10, `icon`
  size-8→size-10, etc.)
- `src/components/ui/dialog.tsx` — `sm:max-w-sm` → `sm:max-w-md`, padding `p-4` →
  `p-5` (footer margins matched)
- `src/components/app-shell.tsx` — new; owns the mobile drawer open/close state,
  renders the hamburger bar on small screens
- `src/components/sidebar/Sidebar.tsx` — now fills its parent (`w-full` instead of a
  hardcoded `w-72`, width is controlled by `AppShell`), bigger padding/icons,
  `onLinkClick` callback (closes the mobile drawer after a successful upload)
- `src/app/page.tsx` — wraps content in `<AppShell>` instead of rendering
  `<Sidebar>` directly

## Verification
- `tsc --noEmit` and `bun run lint` clean after each change
- Dev server hot-reload logs checked for compile errors after each pass
- Material Design comparison approved by the user via a private Artifact before
  porting colors into real code
- Not yet done: manually resizing the browser / a real mobile device to confirm the
  drawer open/close interaction and touch-target feel end-to-end
