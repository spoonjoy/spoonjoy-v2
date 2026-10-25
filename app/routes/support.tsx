import type { Route } from "./+types/support";
import type { ReactNode } from "react";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Heading } from "~/components/ouro/text/heading";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";

const CONTACT_EMAIL = "ari@spoonjoy.app";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Support | Spoonjoy" },
    { name: "description", content: "Get help with Spoonjoy: contact us, delete your account, report content and export your data." },
  ];
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <Heading level={3} size="lg">{title}</Heading>
      <div className="mt-2 space-y-3 text-base/7 text-[var(--sj-ink-soft)]">{children}</div>
    </section>
  );
}

export default function Support() {
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Spoonjoy"
        title="Support"
        size="lg"
        divider
        description="Help with your kitchen, your account and your data."
      />

      <div className="mt-6 max-w-2xl">
        <section>
          <Heading level={2} size="xl">Contact us</Heading>
          <Text tone="muted" className="mt-3">
            Email <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link> with anything: a bug, a
            question, a recipe that won't import or an idea. A person reads every message, usually within
            a day.
          </Text>
        </section>

        <Heading level={2} size="xl" className="mt-10">Questions</Heading>

        <Question title="How do I delete my account?">
          <Text tone="muted">
            Open <Link href="/account/settings#delete-account">Settings, Your data</Link> and choose
            Delete account. In the iPhone app, go to Settings and tap Delete account. Your recipes,
            cookbooks, cooks, photos and sign-ins are deleted for good. Recipes other chefs forked stay
            with them, credited to a deleted chef.
          </Text>
        </Question>

        <Question title="How do I report something or block a chef?">
          <Text tone="muted">
            On any recipe or chef page, choose Report. Pick what's wrong and send it; Spoonjoy reviews
            every report within 24 hours, removes content that breaks the{" "}
            <Link href="/terms">terms</Link> and removes chefs who post it. What you report disappears
            from your kitchen at once.
          </Text>
          <Text tone="muted">
            In the same dialog you can block the chef. You won't see their recipes, cookbooks, cooks or
            profile, and you won't get notifications from them. Unblock them any time in{" "}
            <Link href="/account/settings#blocked-chefs">Settings, Blocked chefs</Link>.
          </Text>
        </Question>

        <Question title="How do I export my data?">
          <Text tone="muted">
            Open <Link href="/account/settings#delete-account">Settings, Your data</Link> and choose
            Download my data. You get one file with your account, recipes, cookbooks, cooks and
            shopping list.
          </Text>
        </Question>

        <section className="mt-10">
          <Heading level={2} size="xl">Policies</Heading>
          <Text tone="muted" className="mt-3">
            Read the <Link href="/privacy">Privacy Policy</Link> and the{" "}
            <Link href="/terms">Terms of Service</Link>.
          </Text>
        </section>
      </div>
    </CookbookPage>
  );
}
