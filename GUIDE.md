# 🍳 Spoonjoy v2 — Getting Started Guide

*From zero to cooking in 5 minutes*

---

## Welcome!

Spoonjoy is a recipe management app built with modern web tech: React Router v7 on Cloudflare's edge. You're about to clone it, run it locally, and explore a beautifully architected recipe platform.

**What you'll have when you're done:**
- A running app where you can create, edit, and organize recipes
- A component library to explore (Storybook)
- A comprehensive test suite

Let's go! 🚀

---

## Part 1: Clone & Install

### Prerequisites

You'll need:
- **Node.js 22.x** (`node --version` to check; the app pins `>=22 <23`)
- **pnpm 10.28.1** (`pnpm --version` to check; install via `corepack enable` if needed)
- A terminal
- ~5 minutes

### Clone the Repository

```bash
git clone https://github.com/arimendelow/spoonjoy-v2.git
cd spoonjoy-v2
```

### Install Dependencies

```bash
pnpm install
```

This installs everything: React Router, Prisma, Tailwind, testing tools, Storybook — the works.

---

## Part 2: Database Setup

Spoonjoy uses Cloudflare D1 (SQLite at the edge). For local development, the Cloudflare Vite plugin runs a local D1 instance automatically — you just need to create the tables.

### Generate Prisma Client

```bash
pnpm prisma:generate
```

### Create the Database Tables

```bash
pnpm exec wrangler d1 migrations apply DB --local
```

That's it! The local D1 database is ready.

### Optional: Seed Demo Data

To populate the database with sample recipes and a demo user:

```bash
pnpm db:seed
```

This creates:
- **Demo account** — Ready to log in immediately
- **3 sample recipes** — Including step dependencies (StepOutputUse)
- **Units & ingredients** — Common cooking measurements

**Demo login credentials:**
- Email: `demo@spoonjoy.com`
- Password: `demo1234`

> **Note:** No `.env` file needed for basic local development. Session secrets and other config have sensible defaults.

---

## Part 3: Run the App! 🎉

```bash
pnpm dev
```

Open **http://localhost:5173** — welcome to Spoonjoy!

### What You'll See

1. **Landing page** — Clean, minimal homepage with "Get Started" prompt
2. **Navigation** — Spoonjoy logo, theme toggle, Login/Sign Up buttons
3. **Footer** — "Built with React Router v7 on Cloudflare"

### Create Your Account

1. Click **Sign Up**
2. Enter your email, username, and password
3. Click **Sign Up**
4. You're redirected to `/recipes` — you're in!

> **Tip:** Passwords are securely hashed with bcrypt. OAuth (Google/Apple) requires API credentials; `/auth/google`, `/auth/google/callback`, `/auth/apple`, and `/auth/apple/callback` are wired for login and account linking.

---

## Part 4: Create Your First Recipe

Let's make something delicious — how about a classic grilled cheese?

### Step 1: Add the Recipe

1. Navigate to **My Kitchen** (you should already be there after signup)
2. Click **New Recipe**
3. Fill in:
   - **Title**: `Ultimate Grilled Cheese`
   - **Description**: `The only grilled cheese recipe you'll ever need`
   - **Servings**: `1`
   - **Recipe Image**: upload a favorite sandwich photo if you have one
4. Click **Create Recipe**

> **Local image note:** Production stores profile and recipe images in the `PHOTOS` R2 bucket. Local development falls back to data URLs when that bucket binding is unavailable, so uploads still work without extra setup.

### Step 2: Add Steps

Recipes are built from steps, and each step can have its own ingredients. Click **Add Step**:

**Step 1: Prep the butter**
- Description: `Let 2 tablespoons of butter soften at room temperature`
- Add ingredient: `2 tbsp butter`

**Step 2: Assemble the sandwich**
- Description: `Layer cheese between two slices of bread`
- Add ingredients: 
  - `2 slices bread`
  - `2 slices cheddar cheese`

**Step 3: Grill it**
- Description: `Spread softened butter on the outside of each bread slice. Grill on medium heat until golden brown, about 2-3 minutes per side.`
- Here's the magic: check **Uses output from** and select **Step 1** (the softened butter!)

🎯 **This is Spoonjoy's killer feature**: steps can reference outputs from previous steps. It makes recipes flow naturally.

### Step 3: Admire Your Work

Navigate back to your recipe. You'll see:
- Your steps in order
- Ingredients listed per step
- Dependencies shown clearly ("uses softened butter from Step 1")

---

## Part 5: Explore the Features

Now that you have the basics, let's tour the rest:

### Cookbooks 📚

Organize recipes into collections:

1. Go to **Cookbooks** → **New Cookbook**
2. Name it `Quick Weeknight Meals`
3. Add your grilled cheese (and future recipes!)

### Shopping List 🛒

Every user gets a personal shopping list:

1. Go to **Shopping List**
2. Add items manually
3. Check items off as you shop

### Account Settings ⚙️

Under your profile:
- Link OAuth providers (Google, Apple) if configured
- Update your account info

---

## Part 6: Explore the Component Library

Spoonjoy includes a full Storybook with 34 documented components.

```bash
pnpm storybook
```

Opens at **http://localhost:6006**

### Highlights to Check Out

| Story | What You'll See |
|-------|-----------------|
| **Introduction** | Project philosophy & setup |
| **Component Inventory** | Every component at a glance |
| **Design Tokens** | Color palette, spacing, typography |
| **Button** | 22 color variants, outline/plain modes |
| **Dialog** | Modal patterns with animations |
| **Combobox** | Searchable dropdown with autocomplete |
| **StepOutputUseDisplay** | The custom step dependency component |

The components are from [Catalyst](https://tailwindui.com/templates/catalyst), Tailwind Labs' headless library — production-quality, accessible, beautiful.

---

## Part 7: Run the Tests

The test suite has 68,000+ lines of tests covering auth, recipes, steps, ingredients, and all components.

```bash
# Run all tests
pnpm test

# Run with a pretty UI
pnpm test:ui

# Run with coverage report
pnpm test:coverage
```

### Test Areas

| Directory | What's Tested |
|-----------|---------------|
| `test/lib/` | Auth, OAuth, validation, step logic |
| `test/routes/` | Full route integration tests |
| `test/models/` | Data layer & database operations |
| `test/components/` | UI component behavior |

---

## Part 8: Understand the Architecture

### Tech Stack at a Glance

| Layer | Tech |
|-------|------|
| Framework | React Router v7 (née Remix) |
| Styling | Tailwind CSS v4 |
| Database | Cloudflare D1 (local & production) |
| ORM | Prisma with D1 adapter |
| Auth | Custom + Google/Apple OAuth |
| Testing | Vitest + Testing Library |
| Components | Storybook 10 |
| Deploy | Cloudflare Pages/Workers |

### Directory Structure

```
spoonjoy-v2/
├── app/
│   ├── components/ui/    # Catalyst components (27 files)
│   ├── lib/              # Server utilities (auth, validation, etc.)
│   ├── routes/           # Page components with loaders/actions
│   └── root.tsx          # App shell with navigation
├── prisma/
│   └── schema.prisma     # Database schema
├── migrations/
│   ├── 0000_init.sql     # Initial D1 migration
│   └── 0005_*.sql        # Ordered follow-up migrations
├── test/                 # Comprehensive test suite
├── stories/              # Storybook documentation
└── .wrangler/            # Local D1 database (auto-created)
```

### The React Router Pattern

Every route follows this pattern:

```typescript
// 1. Loader: Fetch data server-side
export async function loader({ request, context }) {
  const userId = await requireUserId(request);
  const db = getDb(context.cloudflare.env);
  const recipes = await db.recipe.findMany({ where: { chefId: userId } });
  return { recipes };
}

// 2. Action: Handle form submissions
export async function action({ request, context }) {
  const formData = await request.formData();
  // Process the form...
  return redirect("/recipes");
}

// 3. Component: Render with loaded data
export default function Recipes() {
  const { recipes } = useLoaderData<typeof loader>();
  return <RecipeList recipes={recipes} />;
}
```

---

## Part 9: What's Next?

### Ideas to Explore

1. **Add more recipes** — Try something complex with multiple step dependencies

2. **Explore the schema** — Open `prisma/schema.prisma` and trace the relationships

3. **Modify a component** — Change a button color in `app/components/ui/button.tsx`

4. **Add a test** — Find a route in `test/routes/` and add a new test case

5. **Build for production** — `pnpm build` creates an optimized bundle

6. **Check deploy readiness** — `pnpm deploy:preflight` verifies the Cloudflare bindings, documented secrets, scripts, and migrations used by production deploys. See `docs/deployment.md` for the full checklist.

### Future Features (In Progress)

- Recipe import from URLs
- Recipe scaling (serves 4 → serves 8)
- Timer integration for steps
- Nutrition information
- Recipe sharing

---

## Quick Reference

| Command | What It Does |
|---------|--------------|
| `pnpm dev` | Start the dev server |
| `pnpm storybook` | Launch component explorer |
| `pnpm test` | Run test suite |
| `pnpm test:ui` | Tests with visual UI |
| `pnpm prisma:generate` | Regenerate Prisma client |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript validation |
| `pnpm deploy:preflight` | Verify Cloudflare deploy readiness |

---

## Troubleshooting

### "The table `main.User` does not exist"

The D1 database tables haven't been created. Run:

```bash
pnpm exec wrangler d1 migrations apply DB --local
```

### "Cannot find module '@prisma/client'"

The Prisma client needs to be generated. Run:

```bash
pnpm prisma:generate
```

### Port already in use

The dev server will automatically try the next available port (5173 → 5174 → 5175...). Check the terminal output for the actual URL.

### OAuth login not working

OAuth requires API credentials. For local development, put them in `.dev.vars`; for production, set them with `wrangler secret put`:

```bash
SESSION_SECRET=local-dev-secret-change-me
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
OPENAI_API_KEY=sk-...
```

For local development, email/password login works without any additional setup.

---

## Get Involved

- **GitHub**: https://github.com/arimendelow/spoonjoy-v2
- **Issues**: Feature requests, bugs, ideas welcome
- **Storybook (Live)**: https://697bd34029fa33717b859aff-inamkrsowd.chromatic.com/

---

*Happy cooking! 🍳🦝*
