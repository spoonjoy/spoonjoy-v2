import type { Route } from "./+types/account.deleted";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Text, TextLink } from "~/components/ui/text";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Account deleted - Spoonjoy" },
    { name: "robots", content: "noindex" },
  ];
}

export default function AccountDeleted() {
  return (
    <CookbookPage>
      <div className="mx-auto max-w-2xl">
        <CookbookHeader eyebrow="Spoonjoy" title="Your account is deleted">
          <Text className="mt-4 text-base/7">
            Your recipes, cookbooks, shopping list, cooks and sign-in methods are gone, and every app and agent you
            connected has lost access. Recipes other cooks forked, saved or cooked stay up, credited to a “Deleted chef” placeholder.
          </Text>
        </CookbookHeader>
        <Text className="mt-6 text-base/7">Thanks for cooking with us. You're welcome back any time.</Text>
        <div className="mt-2 flex flex-wrap gap-x-6">
          <TextLink href="/signup">Create a new account</TextLink>
          <TextLink href="/privacy#deletion">How we handle deleted accounts</TextLink>
        </div>
      </div>
    </CookbookPage>
  );
}
