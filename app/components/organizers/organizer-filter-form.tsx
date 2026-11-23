// The filter under a recipe list's search: a Has and a Leave out choice for each of the cook's tags, categories and
// tools, sent with the search query as `with=` and `without=`. The loader gives each choice's value and the filters
// already in the address, so this file needs nothing from the kitchen domain but types.
import { Form } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { CheckboxGroup } from "~/components/ouro/checkbox/checkbox-group";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { Link } from "~/components/ouro/link/link";
import type { OrganizerChoices } from "~/domains/kitchen/index.server";
import { ORGANIZER_KIND_COPY, ORGANIZER_KIND_ORDER } from "./organizer-kinds";

export function OrganizerFilterForm({
  label,
  query,
  filterParams,
  choices,
  clearHref,
}: {
  label: string;
  query: string;
  filterParams: [string, string][];
  choices: OrganizerChoices;
  clearHref: string;
}) {
  const options = ORGANIZER_KIND_ORDER.flatMap((kind) =>
    choices[kind].map(({ name, value }) => ({
      value,
      label: name,
      description: ORGANIZER_KIND_COPY[kind].one,
    })),
  );
  if (options.length === 0) return null;
  const active = filterParams.length;
  const chosen = (side: string) => filterParams.filter(([name]) => name === side).map(([, value]) => value);

  return (
    <Form method="get" aria-label={label} className="mt-4">
      <Collapsible title={active ? `Filter (${active})` : "Filter"} defaultOpen={active > 0}>
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <div className="flex flex-col gap-6 sm:flex-row">
          <CheckboxGroup legend="Has" name="with" defaultValue={chosen("with")} options={options} className="flex-1" />
          <CheckboxGroup legend="Leave out" name="without" defaultValue={chosen("without")} options={options} className="flex-1" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" variant="outline" tone="secondary">Apply filters</Button>
          {active ? <Link href={clearHref}>Clear filters</Link> : null}
        </div>
      </Collapsible>
    </Form>
  );
}
