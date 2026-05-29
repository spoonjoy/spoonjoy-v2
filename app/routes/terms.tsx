import type { Route } from "./+types/terms";
import type { ReactNode } from "react";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Subheading } from "~/components/ui/heading";
import { Text, TextLink } from "~/components/ui/text";

const LAST_UPDATED = "May 29, 2026";
const CONTACT_EMAIL = "ari@spoonjoy.app";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Terms of Service | Spoonjoy" },
    { name: "description", content: "The terms for using Spoonjoy." },
  ];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <Subheading level={2} className="text-2xl/8">{title}</Subheading>
      <div className="mt-3 space-y-3 text-base/7 text-[var(--sj-ink-soft)]">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <CookbookPage>
      <CookbookHeader eyebrow="Spoonjoy" title="Terms of Service">
        <Text>Last updated {LAST_UPDATED}.</Text>
      </CookbookHeader>

      <div className="mt-6 max-w-2xl">
        <Text>
          These terms govern your use of Spoonjoy. By creating an account or using the
          service, you agree to them.
        </Text>

        <Section title="Your account">
          <Text>
            You are responsible for your account and for keeping your sign-in methods secure.
            Provide accurate information, and let us know promptly if you suspect unauthorized
            access.
          </Text>
        </Section>

        <Section title="Acceptable use">
          <Text>You agree not to:</Text>
          <ul className="list-disc space-y-2 pl-6">
            <li>Break the law or infringe others’ rights with your content.</li>
            <li>Upload malware, attempt to disrupt the service, or bypass security or rate limits.</li>
            <li>Access other users’ private data, or scrape the service in ways that harm it.</li>
            <li>Post content that is abusive, deceptive, or otherwise harmful.</li>
          </ul>
        </Section>

        <Section title="Your content">
          <Text>
            You keep ownership of the recipes, cookbooks, photos, and other content you create.
            You grant Spoonjoy the permission needed to host, store, display, and back up that
            content so we can provide the service. When you publish a recipe or cookbook, you
            allow other users to view it and to fork or save it within Spoonjoy. You are
            responsible for having the rights to the content you upload.
          </Text>
        </Section>

        <Section title="API tokens and connectors">
          <Text>
            You may create API tokens and authorize connectors (including AI assistants) to act
            on your behalf within the scope you approve. You are responsible for tokens and
            authorizations you issue; revoke them from account settings if they are no longer
            needed. Automated access must respect rate limits and these terms.
          </Text>
        </Section>

        <Section title="Service availability">
          <Text>
            Spoonjoy is provided “as is,” without warranties of any kind. We may change,
            suspend, or discontinue features, and we don’t guarantee uninterrupted or
            error-free operation. Keep your own copies of content that matters to you.
          </Text>
        </Section>

        <Section title="Limitation of liability">
          <Text>
            To the maximum extent permitted by law, Spoonjoy is not liable for indirect,
            incidental, or consequential damages, or for any loss of data or content arising
            from your use of the service.
          </Text>
        </Section>

        <Section title="Termination">
          <Text>
            You may stop using Spoonjoy and request deletion of your account at any time. We
            may suspend or terminate access that violates these terms or that we reasonably
            believe is harmful to the service or other users.
          </Text>
        </Section>

        <Section title="Changes to these terms">
          <Text>
            We may update these terms as Spoonjoy evolves. Material changes will be reflected in
            the “last updated” date above; continued use means you accept the updated terms.
          </Text>
        </Section>

        <Section title="Contact">
          <Text>
            Questions about these terms? Email{" "}
            <TextLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</TextLink>. See also our{" "}
            <TextLink href="/privacy">Privacy Policy</TextLink>.
          </Text>
        </Section>
      </div>
    </CookbookPage>
  );
}
