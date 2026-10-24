import type { Route } from "./+types/test-kitchen";
import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { RecipeCookView } from "~/components/cook/RecipeCookView";
import { CookTimerTray } from "~/components/recipe/CookTimers";
import { SCALE_RANGE } from "~/components/cook/cook-controller";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { AspectRatio } from "~/components/ouro/aspect-ratio/aspect-ratio";
import { Button } from "~/components/ouro/button/button";
import { Inspector } from "~/components/ouro/inspector/inspector";
import { NumberField } from "~/components/ouro/number-field/number-field";
import { Switch } from "~/components/ouro/switch/switch";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";
import { claim } from "~/lib/ouro/claims";
import { useLocalCookController } from "~/lib/cook/local-cook-controller";
import { sourceHrefFor, type PageProvenance } from "~/lib/ouro-provenance";
import { pageProvenance } from "~/lib/ouro-provenance.server";
import { scaleServingsText } from "~/lib/quantity";
import { TEST_KITCHEN } from "~/lib/test-kitchen/content";
import { resetTestKitchen, testKitchenProgressStorage } from "~/lib/test-kitchen/storage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Test Kitchen | Spoonjoy" },
    {
      name: "description",
      content: "Cook a Spoonjoy recipe without an account: tick off ingredients, scale it, run its timer, and turn on X-ray to see the Ouro HX components it is built from.",
    },
  ];
}

const INTRO = claim("A real Spoonjoy recipe page, open to everyone. Nothing here needs an account, and your progress stays in this browser.", {
  source: { test: "test/routes/test-kitchen.test.tsx::Test Kitchen > opens to anyone: the recipe, what to try, and a way to sign up, with no request of its own" },
  verify: [
    { testExists: "test/routes/test-kitchen.test.tsx::Test Kitchen > opens to anyone: the recipe, what to try, and a way to sign up, with no request of its own" },
    { testExists: "test/routes/test-kitchen.test.tsx::Test Kitchen > keeps a visitor's ticks in this browser" },
  ],
});

const WHAT_TO_TRY = [
  "Tick off the first step's ingredients. Your progress stays in this browser.",
  "Change the scale and watch every amount follow.",
  "Start cooking, then run the twelve-minute timer on step one.",
  "Turn on X-ray to see every Ouro HX component on the page, with its docs and its source.",
];

/** Only where this page's source lives: the recipe is bundled, and there is no account or database. */
export function loader({}: Route.LoaderArgs) {
  return { provenance: pageProvenance("app/routes/test-kitchen.tsx") };
}

export default function TestKitchen() {
  const { provenance } = useLoaderData<typeof loader>();
  return <TestKitchenPage provenance={provenance} />;
}

/** The Test Kitchen, given where its source lives (for X-ray's Source links). */
export function TestKitchenPage({ provenance }: { provenance: PageProvenance }) {
  const [searchParams] = useSearchParams();
  const [xray, setXray] = useState(() => searchParams.has("xray"));
  // Resetting starts the kitchen over: a new controller, reading the storage it just emptied.
  const [visit, setVisit] = useState(0);

  return (
    <>
      <TestKitchenRecipe
        key={visit}
        xray={xray}
        onXrayChange={setXray}
        onReset={() => {
          resetTestKitchen();
          setVisit((current) => current + 1);
        }}
      />
      <Inspector open={xray} onOpenChange={setXray} sourceHref={sourceHrefFor(provenance)} />
    </>
  );
}

function TestKitchenRecipe({ xray, onXrayChange, onReset }: {
  xray: boolean;
  onXrayChange: (open: boolean) => void;
  onReset: () => void;
}) {
  const controller = useLocalCookController(TEST_KITCHEN.recipe, testKitchenProgressStorage);
  const { recipe, cover } = TEST_KITCHEN;

  // Cook mode is the whole page, as on a recipe of your own.
  if (controller.cookMode) {
    return <RecipeCookView controller={controller} />;
  }

  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Try Spoonjoy"
        title="Spoonjoy Test Kitchen"
        description={INTRO}
        actions={<Button href="/signup">Make it yours: sign up</Button>}
        size="lg"
        divider
      />

      <section aria-labelledby="test-kitchen-try" className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div>
          <Heading level={2} size="lg" id="test-kitchen-try">What to try</Heading>
          <ul className="mt-3 grid list-disc gap-2 ps-6 text-base/7 text-[var(--sj-ink)]">
            {WHAT_TO_TRY.map((idea) => <li key={idea}>{idea}</li>)}
          </ul>
        </div>
        <div className="grid gap-4 md:justify-items-end">
          <Switch
            label="X-ray"
            description="Outlines the Ouro HX components on this page, with links to their docs and source."
            checked={xray}
            onCheckedChange={onXrayChange}
          />
          <Button variant="outline" tone="secondary" onClick={onReset}>Reset the kitchen</Button>
        </div>
      </section>

      <section aria-labelledby="test-kitchen-recipe" className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <AspectRatio ratio={cover.width / cover.height}>
          <img src={cover.src} alt={cover.alt} width={cover.width} height={cover.height} />
        </AspectRatio>
        <div className="grid gap-5">
          <Heading level={2} size="display" id="test-kitchen-recipe">{recipe.title}</Heading>
          <Text size="lg" tone="muted">{TEST_KITCHEN.description}</Text>
          <NumberField
            label="Scale"
            description={scaleServingsText(TEST_KITCHEN.servings, controller.scaleFactor)}
            value={controller.scaleFactor}
            {...SCALE_RANGE}
            format={{ maximumFractionDigits: 2 }}
            decrementLabel="Decrease scale"
            incrementLabel="Increase scale"
            onValueChange={(next) => {
              if (next !== null) controller.setScale(next);
            }}
          />
          <Button onClick={controller.enterCookMode}>Start cooking</Button>
        </div>
      </section>

      <CookTimerTray timers={controller.timers} />
      <RecipeCookView controller={controller} />
    </CookbookPage>
  );
}
