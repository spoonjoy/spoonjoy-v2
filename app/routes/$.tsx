import type { Route } from "./+types/$";
import { data } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "404 - Page not found | Spoonjoy" },
    { name: "description", content: "The page you requested could not be found." },
  ];
}

export function loader() {
  return data(null, { status: 404 });
}

export default function CatchAll() {
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="404"
        title="Page not found"
        size="lg"
        divider
        description="The page you are looking for does not exist or may have moved."
      />
      <div className="mt-6">
        <Button href="/">Go home</Button>
      </div>
    </CookbookPage>
  );
}
