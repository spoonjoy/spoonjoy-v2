import type { Route } from "./+types/$";
import { data } from "react-router";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";

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
    <div className="sj-page px-4 py-12 sm:py-20">
      <section className="sj-panel mx-auto max-w-2xl rounded-[2rem] p-8">
        <p className="sj-eyebrow">404</p>
        <Heading level={1} className="mt-4 text-4xl/11 tracking-[-0.04em]">
          Page not found
        </Heading>
        <Text className="mt-3 text-base/7">
          The page you are looking for does not exist or may have moved.
        </Text>
        <div className="mt-6">
          <Button href="/">Go home</Button>
        </div>
      </section>
    </div>
  );
}
