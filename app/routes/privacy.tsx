import type { Route } from "./+types/privacy";
import type { ReactNode } from "react";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Subheading } from "~/components/ui/heading";
import { Text, TextLink } from "~/components/ui/text";

const LAST_UPDATED = "May 29, 2026";
const CONTACT_EMAIL = "ari@spoonjoy.app";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Privacy Policy | Spoonjoy" },
    { name: "description", content: "How Spoonjoy collects, uses, and protects your data." },
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

export default function Privacy() {
  return (
    <CookbookPage>
      <CookbookHeader eyebrow="Spoonjoy" title="Privacy Policy">
        <Text>Last updated {LAST_UPDATED}.</Text>
      </CookbookHeader>

      <div className="mt-6 max-w-2xl">
        <Text>
          Spoonjoy is a personal recipe kitchen. This policy explains what we collect, why,
          and the choices you have. We collect the minimum needed to run the product and we
          do not sell your personal information.
        </Text>

        <Section title="Information we collect">
          <Text>When you create an account and use Spoonjoy, we store:</Text>
          <ul className="list-disc space-y-2 pl-6">
            <li>Account details: your email address and username. Passwords are stored only as a salted hash, never in plain text.</li>
            <li>Sign-in methods you choose to connect: passkeys (WebAuthn credentials) and OAuth provider account identifiers from Apple, GitHub, or Google. We request only your name and email from those providers and never receive your provider password.</li>
            <li>Your content: recipes, cookbooks, shopping lists, cook logs, notes, and any photos you upload.</li>
            <li>API tokens and connector authorizations you create for programmatic or AI-assistant access. Token secrets are stored hashed and shown only once.</li>
            <li>Optional push-notification subscriptions, if you enable notifications.</li>
            <li>Limited technical and product-usage data (for example, error reports and feature interactions) to keep the service reliable.</li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc space-y-2 pl-6">
            <li>To operate your kitchen: store and display your recipes, cookbooks, shopping lists, and cooks.</li>
            <li>To authenticate you and keep your account secure.</li>
            <li>To deliver notifications you have opted into.</li>
            <li>To diagnose errors and improve reliability and features.</li>
          </ul>
        </Section>

        <Section title="What others can see">
          <Text>
            Recipes and cookbooks you publish are visible to anyone, along with your username
            and profile photo. Your shopping list, cook notes, account email, and API tokens
            are private to you. Anything you mark or keep public can be viewed, forked, and
            saved by other people.
          </Text>
        </Section>

        <Section title="Service providers we rely on">
          <Text>
            We share data only with infrastructure providers that process it on our behalf to
            run Spoonjoy:
          </Text>
          <ul className="list-disc space-y-2 pl-6">
            <li>Cloudflare — application hosting, database, and image storage.</li>
            <li>Product analytics and error monitoring — usage and error data, with on-page text masked by default.</li>
            <li>OpenAI — only when you import a recipe from a URL or generate a recipe image, to process that specific request.</li>
            <li>Apple, GitHub, and Google — only if you choose to sign in with them.</li>
            <li>Web-push services — only if you enable notifications.</li>
          </ul>
          <Text>We do not sell your personal information or share it for advertising.</Text>
        </Section>

        <Section title="Connectors and AI assistants">
          <Text>
            You can connect Spoonjoy to AI assistants (for example, through the Model Context
            Protocol connector). Connectors act on your behalf using a scoped authorization
            you approve, and you can revoke that access at any time from your account settings.
            We never ask an assistant for your Spoonjoy password.
          </Text>
        </Section>

        <Section title="Data retention">
          <Text>
            We keep your account and content for as long as your account is active. Deleting a
            recipe or shopping-list item removes it from your kitchen. If you want your account
            and associated data deleted, contact us and we will remove it.
          </Text>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc space-y-2 pl-6">
            <li>Update your profile and content at any time.</li>
            <li>Revoke API tokens and connector access from account settings.</li>
            <li>Turn notifications off at any time.</li>
            <li>Request export or deletion of your data by emailing us.</li>
          </ul>
        </Section>

        <Section title="Children">
          <Text>
            Spoonjoy is not directed to children under 13, and we do not knowingly collect
            personal information from them.
          </Text>
        </Section>

        <Section title="Changes to this policy">
          <Text>
            We may update this policy as Spoonjoy evolves. Material changes will be reflected
            in the “last updated” date above.
          </Text>
        </Section>

        <Section title="Contact">
          <Text>
            Questions or requests? Email{" "}
            <TextLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</TextLink>.
          </Text>
        </Section>
      </div>
    </CookbookPage>
  );
}
