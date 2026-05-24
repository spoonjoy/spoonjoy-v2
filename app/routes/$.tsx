import type { Route } from "./+types/$";
import { data } from "react-router";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";

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
      <CookbookHeader eyebrow="404" title="Page not found">
        <Text>
          The page you are looking for does not exist or may have moved.
        </Text>
      </CookbookHeader>
      <div className="mt-6">
        <Button href="/">Go home</Button>
      </div>
    </CookbookPage>
  );
}
