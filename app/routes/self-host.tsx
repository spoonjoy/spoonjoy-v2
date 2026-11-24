import type { Route } from "./+types/self-host";
import type { ReactNode } from "react";
import { CookbookPage } from "~/components/cookbook/page";
import { Alert } from "~/components/ouro/alert/alert";
import { CodeBlock } from "~/components/ouro/code-block/code-block";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Text } from "~/components/ouro/text/text";

const PAGE_URL = "https://spoonjoy.app/self-host";
const GUIDE_URL = "https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/self-hosting.md";
const TITLE = "Run Spoonjoy on your own server | Spoonjoy";
const DESCRIPTION =
  "Spoonjoy on your own box: one container for amd64 and arm64, started with Docker Compose, with your kitchen kept in one data volume.";

/**
 * Whether ghcr.io/spoonjoy/spoonjoy can be pulled without signing in. Ari makes the package public;
 * flip this then, and the Self-host Pull workflow (.github/workflows/self-host-pull.yml) proves it.
 */
export const IMAGE_PUBLIC = false;

/** self-host/compose.yaml as it stands; test/routes/self-host.test.tsx fails when the two differ. */
export const COMPOSE = `# Spoonjoy with Docker Compose. Start it
# beside this file with \`docker compose up -d\`,
# then open http://localhost:8080.
# Set SPOONJOY_BASE_URL to the address people
# use; docs/self-hosting.md lists every setting.
services:
  spoonjoy:
    image: \${SPOONJOY_IMAGE:-ghcr.io/spoonjoy/spoonjoy:latest}
    restart: unless-stopped
    ports:
      - "\${SPOONJOY_PORT:-8080}:8080"
    volumes:
      - spoonjoy-data:/data
    environment:
      SPOONJOY_BASE_URL: \${SPOONJOY_BASE_URL:-http://localhost:8080}

volumes:
  spoonjoy-data:
`;

export const START = "docker compose up -d";
export const UPDATE = "docker compose pull && docker compose up -d";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: PAGE_URL },
    { tagName: "link", rel: "canonical", href: PAGE_URL },
  ];
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="mt-12 scroll-mt-20 first:mt-10">
      <SectionHeader title={title} />
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Says the image isn't out yet, until it is public. */
export function ImageNotice({ imagePublic }: { imagePublic: boolean }) {
  if (imagePublic) return null;
  return (
    <Alert
      className="mt-8"
      tone="primary"
      title="Image coming soon"
      description="The image is built and checked on every change, and opens to everyone soon. Until then these steps are here to read ahead."
    />
  );
}

export default function SelfHost() {
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Spoonjoy"
        title="Run Spoonjoy on your own server"
        size="lg"
        divider
        // The intro runs the page's full width, as the sections under it do.
        className="[&_[data-slot=description]]:max-w-none"
        description="The same Spoonjoy as spoonjoy.app, in one container on your own box, for amd64 and arm64. Your recipes, photos and accounts stay in one data volume you keep."
      />

      <div>
        <ImageNotice imagePublic={IMAGE_PUBLIC} />

        <Section id="self-host-start" title="Start it">
          <Text>Save this as <code>compose.yaml</code>:</Text>
          <CodeBlock code={COMPOSE} title="compose.yaml" language="yaml" wrap />
          <Text>Then start it beside that file:</Text>
          <CodeBlock code={START} language="sh" wrap />
          <Text>
            Open <code>http://localhost:8080</code> and sign up. To use another address or port, set <code>SPOONJOY_BASE_URL</code> and{" "}
            <code>SPOONJOY_PORT</code> in a <code>.env</code> file beside it.
          </Text>
        </Section>

        <Section id="self-host-first-account" title="What the first account gets">
          <Text>The first account you make is the server's admin. In Server settings, the admin:</Text>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li><Text as="span">decides who else can join: the server is invite-only after the first account, and each invite link signs up one person;</Text></li>
            <li><Text as="span">picks the AI, OpenAI or Gemini with their own key, or no AI at all;</Text></li>
            <li><Text as="span">looks after backups: the server backs itself up every day and keeps the last 7, and the admin can back up, download or restore from there.</Text></li>
          </ul>
          <Text>Everyone signs in with a password or a passkey, and with Sign in with Apple in the Spoonjoy apps. You can add your own sign-in provider too.</Text>
        </Section>

        <Section id="self-host-update" title="Update it">
          <Text>Your kitchen lives in the data volume, so an update swaps only the image. Beside <code>compose.yaml</code>:</Text>
          <CodeBlock code={UPDATE} language="sh" wrap />
          <Text>The new image brings the database up to date when it starts. Make a backup first if you might want to go back.</Text>
        </Section>

        <Text tone="muted" className="mt-12">
          Every setting, backups from the command line, and how it's checked are in the{" "}
          <Link href={GUIDE_URL}>self-hosting guide</Link>.
        </Text>
      </div>
    </CookbookPage>
  );
}
