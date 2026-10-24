import type { Route } from "./+types/account.deleted";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";

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
        <PageHeader
          eyebrow="Spoonjoy"
          title="Your account is deleted"
          size="lg"
          divider
          description="Your recipes, cookbooks, shopping list, cooks and sign-in methods are gone, and every app and agent you connected has lost access. Recipes other cooks forked, saved or cooked stay up, credited to a “Deleted chef” placeholder."
        />
        <Text tone="muted" className="mt-6 leading-7">Thanks for cooking with us. You're welcome back any time.</Text>
        <div className="mt-2 flex flex-wrap gap-x-6">
          <Link href="/signup">Create a new account</Link>
          <Link href="/privacy#deletion">How we handle deleted accounts</Link>
        </div>
      </div>
    </CookbookPage>
  );
}
