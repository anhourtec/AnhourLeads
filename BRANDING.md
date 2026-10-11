# AnhourLeads branding

How every screen looks. Follow this on every change (CLAUDE.md rule 9). It covers fonts, colours, type, layout, components, copy and white-label rules.

---

## Principles

- **Data first.** Prospecting is dense work. Tables, filters and records lead; decoration stays out of the way.
- **Calm and precise.** Neutral surfaces, one brand colour for primary actions and focus, semantic colours only where they carry meaning (status, errors).
- **Provenance is visible.** Where a value came from and how old it is sits next to the value, in muted text, never hidden in a tooltip alone.
- **One system.** The same token, type class and component everywhere. A workspace's brand changes its name and colour, never fonts or layout.

## Reference parity

The app's structure, layout, typography, navigation, flows, modals and helpers follow the reference app recorded in [docs/reference/apollo-ui.md](docs/reference/apollo-ui.md). **Only the colours differ**: we keep our brand tokens and each workspace's brand colour. We never copy the reference's logo, icons, illustrations or copy; icons are Lucide and the words are our own.

## Fonts

| Use | Font | How | Weights |
| --- | --- | --- | --- |
| Body, navigation, tables, forms, buttons | **Inter** (sans, OFL) | default `font-sans` (`--font-inter`, loaded by `next/font` in `src/lib/fonts/registry.ts`) | 400 body, 500 emphasis and active navigation, 600 only for the product name in the sidebar |
| Page titles, card and section titles, large display numbers | **Hanken Grotesk** (OFL) | `font-heading` / `--font-display`; every `h1` uses it; `CardTitle` uses it | 400 for page titles, 500 for card titles |
| Table column headers, small caps labels, counts, ids, emails, domains, URLs, API keys, code | **Roboto Mono** (Apache 2.0) | `font-mono` (`--font-roboto-mono`) | 400, 500 for KPI values |

- Default font preference is `inter`. The display-preferences font picker (avatar menu → Display preferences) stays available for personal preference, but screens are designed and tested in Inter. Headings and mono labels are fixed and don't follow the picker.
- Use `tabular-nums` on numeric columns and KPI values so digits line up.
- Never load another font for a feature. Never set `font-family` inline.

## Colour

All colour comes from semantic tokens defined in `src/app/globals.css` and the brand overrides in `src/styles/brand.css`. Components use token utilities only: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border`, `bg-primary`, `text-primary-foreground`, `ring-ring`, `text-destructive`. **No hex, rgb, hsl or oklch values in components** (AGENTS.md). If a colour is not available as a token, use a named Tailwind palette colour (for example `text-emerald-600 dark:text-emerald-400`), never an arbitrary value.

### Brand colour

| | Value |
| --- | --- |
| Installation default | **Indigo** (`indigo-600` light, `indigo-500` dark) |
| Applied through | `<html data-brand="indigo">` → `--primary`, `--ring`, `--sidebar-primary` (see `src/styles/brand.css`) |
| Used for | Primary buttons, the active navigation item, focus rings, links that are actions, the logo tile, selected states, the sign-in hero panel |
| Not used for | Status meaning, large backgrounds behind body text, charts with more than one series (use the chart tokens) |

Workspaces pick from this palette (`BRAND_COLORS` in `src/config/brand.ts`): indigo, violet, blue, sky, teal, emerald, green, amber, orange, rose, red, slate. Each maps to its 600 shade in light mode and 500 in dark mode, with a foreground chosen for contrast (white, or the 950 shade for light hues such as amber, sky, teal, green and emerald in dark mode).

### Status colours

Status pills use a tinted background with matching text, and **no dot or glyph** before the label.

| Meaning | Examples | Classes |
| --- | --- | --- |
| Positive | valid email, verified hostname, active sequence, won, completed | `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` |
| In progress / neutral | queued, running, draft, pending review, unknown | `bg-muted text-muted-foreground` |
| Attention | catch-all, role address, failing hostname, paused, warming | `bg-amber-500/10 text-amber-700 dark:text-amber-400` |
| Negative | invalid, bounced, failed, lost, do not contact, suppressed | `bg-destructive/10 text-destructive` |
| Informational | replied, meeting, new | `bg-sky-500/10 text-sky-700 dark:text-sky-400` |

Use the `Badge` component (`variant="secondary"` or `outline`) with these classes, `font-medium`, sentence case.

### Light and dark

Every screen must work in both. The theme switcher sets `.dark` on `<html>`; brand overrides have dark variants. Test both (CLAUDE.md rule 7).

## Type scale

| Role | Classes |
| --- | --- |
| Page title (one per page) | `page-title` (Hanken Grotesk, `text-2xl`, weight 400, slight negative tracking). Large first-run titles add `text-3xl`. |
| Page description | `text-sm text-muted-foreground` |
| Section / card title | `text-base font-medium` (CardTitle, display font) |
| Body, table cells, form fields | `text-sm` (Inter) |
| Table column headers | `table-head-mono`: Roboto Mono, 11 px, uppercase, letter-spaced, muted. Applied to every `TableHead` automatically (`[data-slot="table-head"]` in `globals.css`). |
| Labels, meta, provenance, timestamps, helper text | `text-xs text-muted-foreground` |
| KPI value | `font-heading text-2xl tabular-nums` (or `font-mono` for dense numeric tiles) |
| Code, keys, emails, counts | `font-mono text-xs` or `text-sm` |

Display weight is 400 for page titles and 500 for card titles; never bold 700 for headings. Line length for prose stays under about 70 characters (`max-w-prose`).

## Layout and spacing

- The dashboard shell comes from `src/app/(main)/dashboard/layout.tsx`: a 240 px sidebar and a 48 px top bar. Pages render inside its padding (`p-4 md:p-6`).
- **Sidebar** (`src/navigation/sidebar/sidebar-items.ts`): Home (with a calls shortcut) and AI Assistant, then collapsible groups with an icon and a chevron (Prospect and enrich, Engage, Win deals, Tools and automation, Inbound, Saved records) whose links are indented text without icons. Open/closed state is kept in the `nav_groups_closed` cookie. Footer: the onboarding hub card (progress, dismissible), "Email setup and health" and the "Admin settings" menu. On phones the sidebar is a sheet.
- **Top bar**: centred "Search or ask a question" box (⌘K command palette), then a usage link, the AI Assistant button (brand-filled, only with `ai:use`), the activity and notifications bell, and the avatar menu (profile, notification settings, workspace switch, theme, display preferences, sign out). No other header icons.
- **Settings shell**: under `/dashboard/settings` the sidebar swaps to Back, "Search settings", Settings overview and collapsible setting groups (`src/navigation/settings/settings-items.ts`). The overview is a two-column grid of cards (icon, title, one-line description, links).
- **First run**: `/onboarding` is a full-page flow outside the shell, in the workspace brand.
- Page structure: header row (title + description on the left, actions on the right; wraps under each other below `sm`), then content in a `flex flex-col gap-4 md:gap-6` stack.
- Cards: the `Card` component, default radius and border, `gap-4` inside. KPI rows use `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.
- Tables live in a card or bordered container that scrolls horizontally on its own (`overflow-x-auto`). **The page itself never scrolls horizontally**, including at 390 px wide.
- Filters: a left column on desktop, a `Sheet` opened from a "Filters" button below `lg`.
- Breakpoints tested: 1440 (desktop), 834 (tablet), 390 (mobile).

## Components

- Use the local shadcn components in `src/components/ui/`. Never edit them; style where they are used.
- **Buttons:** `size="sm"` with a leading Lucide icon (`data-icon="inline-start"`) for page, table, panel and dialog actions. Only sign-in, sign-up, invite-accept and reset submits use `size="lg"` and full width. One primary button per area; the rest `outline` or `ghost`. Destructive actions use `variant="destructive"` inside a confirm dialog.
- **Icons:** Lucide only, 16 px (`size-4`) inline, decorative icons `aria-hidden="true"`.
- **Logo tile:** a rounded square in `bg-primary` with the Lucide `Radar` icon in `text-primary-foreground`, beside the brand name. Workspaces without a logo use this tile, never the AnhourLeads name.
- **Empty states:** the `Empty` component with an icon, one sentence saying what goes here, and the action that fills it (if the role may take it).
- **Loading:** every data route has a `loading.tsx` skeleton that mirrors the real layout (`Skeleton` component). Buttons show progress text ("Saving…") while pending.
- **Errors:** plain sentences that say what happened and what to do. Never show stack traces or provider error text. API errors return `{ error, details? }` and the UI shows `error`.
- **Toasts** (`sonner`) for results of quick actions; inline `Alert` for errors that block a form.
- **Provenance line:** `text-xs text-muted-foreground`: "csv_import · 3 days ago · 90%".
- **Secrets** (API keys, passwords) are shown once, in `font-mono`, with a copy button and a warning that they won't be shown again; afterwards only "ends in abcd".

## Copy

- Sentence case for everything: titles, buttons, labels, menu items, pills ("Do not contact", not "Do Not Contact").
- Buttons say what they do: "Add person", "Import CSV", "Verify now", "Create API key".
- Talk to the user as "you"; the product doesn't refer to itself as "we" in the interface.
- No exclamation marks, no emoji, no jargon where a plain word works ("Sign in", not "Authenticate").
- Numbers: thousands separators, currency with its code or symbol, relative times for recent events ("3 days ago") with the exact time in a tooltip.

## White-label rules

- A workspace may set its **display name, brand colour and support email** (Settings → Branding). Nothing else: no custom fonts, CSS or layout.
- On a workspace's verified hostname, every page and email shows the workspace's brand. **The installation name "AnhourLeads" never appears there**: not in titles, the sidebar, sign-in pages, emails, or "Powered by" lines.
- On the installation's own hostnames, signed-out pages show the AnhourLeads brand; signed-in pages show the active workspace's brand.
- Emails sent for a workspace use the workspace's display name as the sender name.

## Accessibility

- Semantic HTML (`main`, `nav`, `header`, headings in order, `table` for tabular data).
- Every input has a visible label; icon-only buttons have `aria-label`.
- Visible focus rings (`ring-ring`) on everything interactive; full keyboard support for dialogs, menus and tables.
- Colour is never the only signal: status pills always have text.
- Contrast: text on `bg-primary` uses `text-primary-foreground`, chosen per brand colour for WCAG AA.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created: fonts, colour, type scale, layout, components, copy, white-label rules |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Reference parity rule (only colours differ); Inter / Hanken Grotesk / Roboto Mono; `page-title` and mono table headers; sidebar, top bar, settings shell and first-run layout |
