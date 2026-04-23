# Customization: Theme Variables and Presets

## Pyramid Layer

- Layer: L3 reference leaf.

## Use This When

- Load this after the customization router when the task is about CSS variables, dark mode, presets, or changing the global theme.

## Stop Here If

- Stop once the required theme or preset workflow is clear.

## Descend To

- Return to `/.agents/skills/shadcn/customization.md` for component-customization or update siblings.

Components reference semantic CSS variable tokens. Change the variables to change every component.

## How It Works

1. CSS variables live in `:root` and `.dark`.
2. Tailwind maps them to semantic utilities.
3. Components use those utilities.

## Color Variables

Use the `name` and `name-foreground` convention.

Key variables include `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, chart variables, sidebar variables, and `--surface`.

Colors use OKLCH, for example `--primary: oklch(0.205 0 0)`.

## Dark Mode

Use a class-based toggle via `.dark` on the root element. In Next.js, use `next-themes`.

```tsx
import { ThemeProvider } from 'next-themes'

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

## Changing the Theme

Prefer `apply` for preset changes on an existing project. Use `init --force` only when the user explicitly wants preset changes to rewrite or reinstall generated component sources.

```bash
npx shadcn@latest apply --preset a2r6bw
npx shadcn@latest apply --preset radix-nova
npx shadcn@latest init --preset "https://ui.shadcn.com/init?base=radix&style=nova&theme=blue&..." --force --reinstall
```

Or edit CSS variables directly in `globals.css`.

## Adding Custom Colors

Add variables to the file at `tailwindCssFile` from `npx shadcn@latest info`.

Register them with `@theme inline` for Tailwind v4 or in `tailwind.config.js` for Tailwind v3.

## Border Radius

`--radius` controls border radius globally. Components derive specific radii from it.