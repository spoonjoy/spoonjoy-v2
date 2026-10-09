import type { Route } from "./+types/privacy";
import type { ReactNode } from "react";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Subheading } from "~/components/ui/heading";
import { Text, TextLink } from "~/components/ui/text";

const LAST_UPDATED = "October 9, 2026";
const CONTACT_EMAIL = "ari@spoonjoy.app";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Privacy Policy | Spoonjoy" },
    { name: "description", content: "How Spoonjoy collects, uses, and protects your data." },
  ];
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-24">
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
            Spoonjoy is a public cookbook. Every recipe you create, its covers and photos, your
            cookbooks, the cooks you log (with their notes and photos), your username, and your
            profile photo can be seen by anyone, signed in or not, and can show up in search.
            Other cooks can fork your recipes into their own kitchens and save them to their
            cookbooks.
          </Text>
          <Text>
            Your email address, shopping list, sign-in methods, and API tokens are private to you.
          </Text>
        </Section>

        <Section title="Service providers we rely on">
          <Text>
            We share data only with infrastructure providers that process it on our behalf to
            run Spoonjoy:
          </Text>
          <ul className="list-disc space-y-2 pl-6">
            <li>Cloudflare: application hosting, database, and photo storage.</li>
            <li>PostHog: product analytics and error monitoring, with on-page text masked by default.</li>
            <li>OpenAI: the text of a recipe page you import, the ingredient lines it reads into amounts and units, and the recipe details or photo used to make a recipe cover.</li>
            <li>Google Gemini: the same ingredient lines and cover requests when OpenAI is unavailable, and the photos of your cooks that Spoonjoy restyles into recipe covers.</li>
            <li>Apple, GitHub, and Google: only if you choose to sign in with them.</li>
            <li>Apple, Google, Mozilla, and Microsoft push services: only if you turn on notifications, to deliver them to your browser or device.</li>
          </ul>
          <Text>
            OpenAI and Google receive only what a request needs, not your email address or
            password. We do not sell your personal information or share it for advertising.
          </Text>
        </Section>

        <Section title="Connectors and AI assistants">
          <Text>
            You can connect Spoonjoy to AI assistants (for example, through the Model Context
            Protocol connector). Connectors act on your behalf using a scoped authorization
            you approve, and you can revoke that access at any time from your account settings.
            We never ask an assistant for your Spoonjoy password.
          </Text>
        </Section>

        <Section id="export" title="Download your data">
          <Text>
            In account settings, choose
            Download my data to get one JSON file with your account details, your recipes with
            their steps and ingredients, your cookbooks, shopping list, and cooks, and links to
            your photos. The iPhone app offers the same download in its account screen.
          </Text>
          <TextLink href="/account/settings#delete-account">Open account settings</TextLink>
        </Section>

        <Section id="deletion" title="Deleting your account">
          <Text>
            You can delete your account yourself in account settings or in the iPhone app. We ask
            you to type your username and confirm it is you: with your password, or, if you have
            no password, by signing in again.
          </Text>
          <Text>Deleting your account permanently removes:</Text>
          <ul className="list-disc space-y-2 pl-6">
            <li>your account, email address, and profile photo;</li>
            <li>your recipes, cookbooks, shopping list, and the cooks you logged, with their photos;</li>
            <li>your passkeys, linked sign-in accounts, API tokens, and every app and assistant you connected;</li>
            <li>your notifications, and notifications to other cooks that mention you.</li>
          </ul>
          <Text>
            A recipe of yours that another cook has forked, saved to a cookbook, or cooked stays
            up so their kitchen keeps working, but it is credited to a &ldquo;Deleted chef&rdquo;
            placeholder instead of you. Their forks remain theirs. Photos are erased from storage
            after a short grace period once nothing uses them.
          </Text>
        </Section>

        <Section title="Data retention">
          <Text>
            We keep your account and content for as long as your account is active. Deleting a
            recipe or shopping-list item removes it from your kitchen. Analytics and error data
            already sent to PostHog stay there until PostHog&rsquo;s retention period ends.
          </Text>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc space-y-2 pl-6">
            <li>Update your profile and content at any time.</li>
            <li>Revoke API tokens and connector access from account settings.</li>
            <li>Turn notifications off at any time.</li>
            <li>Download your data or delete your account from account settings, or email us and we will help.</li>
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
