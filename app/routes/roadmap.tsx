import type { Route } from "./+types/roadmap";
import type { ComponentType, SVGProps } from "react";
import {
  Bot,
  BookOpen,
  CalendarDays,
  ChefHat,
  Globe,
  Languages,
  PackageOpen,
  Scale,
  Server,
  ShoppingBasket,
  Smartphone,
  Users,
  Webhook,
} from "lucide-react";
import { CookbookPage } from "~/components/cookbook/page";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";
import {
  ROADMAP_STATUSES,
  roadmapByStatus,
  type RoadmapArea,
  type RoadmapItem,
  type RoadmapStatus,
} from "~/content/roadmap";

const ROADMAP_URL = "https://spoonjoy.app/roadmap";
const TITLE = "Roadmap | Spoonjoy";
const DESCRIPTION =
  "What's shipped in Spoonjoy, what's being built now and what's coming next: meal planning, households, moving in from other recipe apps, your own server and more.";
const CONTACT_EMAIL = "ari@spoonjoy.app";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: ROADMAP_URL },
    { tagName: "link", rel: "canonical", href: ROADMAP_URL },
  ];
}

const AREA_ICONS: Record<RoadmapArea, ComponentType<SVGProps<SVGSVGElement>>> = {
  Recipes: BookOpen,
  Cooking: ChefHat,
  Planning: CalendarDays,
  Shopping: ShoppingBasket,
  Households: Users,
  "Moving in": PackageOpen,
  "Food know-how": Scale,
  Connections: Webhook,
  Languages: Languages,
  "Your own server": Server,
  Community: Globe,
  Apps: Smartphone,
  Agents: Bot,
};

/** Each group's colour: green for live, amber for on the stove, the brand colour for next, quiet for later. */
const STATUS_TONES: Record<RoadmapStatus, "success" | "warning" | "primary" | "secondary"> = {
  shipped: "success",
  building: "warning",
  next: "primary",
  later: "secondary",
};

function things(count: number) {
  return `${count} ${count === 1 ? "thing" : "things"}`;
}

/** One row: the area's icon, what it is, what it does for a cook, where to try it, and when it shipped. */
export function RoadmapRow({ item }: { item: RoadmapItem }) {
  const Icon = AREA_ICONS[item.area];
  return (
    <Item
      media={<Icon />}
      mediaSize="icon"
      title={item.title}
      description={
        <>
          {item.benefit}
          {item.link ? (
            <span className="mt-1 block">
              <Link href={item.link.href}>{item.link.label}</Link>
            </span>
          ) : null}
        </>
      }
      stackBelow="sm"
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[item.status]} variant="soft" dot>{item.area}</Badge>
          {item.shipped ? (
            <Text as="span" size="sm" tone="muted">
              <LocalDate value={item.shipped} format="month" />
            </Text>
          ) : null}
        </span>
      }
    />
  );
}

/** A group of the roadmap: its name, how many things are in it, a line on what it means, and its rows. */
export function RoadmapSection({ status, title, summary, items }: { status: RoadmapStatus; title: string; summary: string; items: RoadmapItem[] }) {
  return (
    <section id={status} aria-label={title} className="mt-12 scroll-mt-20 first:mt-10">
      <SectionHeader title={title} meta={things(items.length)} />
      <Text tone="muted" className="mt-3">{summary}</Text>
      <ItemGroup aria-label={title} variant="divided" className="mt-4">
        {items.map((item) => <RoadmapRow key={item.id} item={item} />)}
      </ItemGroup>
    </section>
  );
}

export default function Roadmap() {
  const groups = ROADMAP_STATUSES.map((status) => ({ ...status, items: roadmapByStatus(status.id) }));
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Spoonjoy"
        title="Roadmap"
        size="lg"
        divider
        description="What's live, what's on the stove and what's coming, in plain words. Every change we ship updates this page."
      />

      <nav aria-label="Roadmap groups" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-sj-ui text-sm">
        {/* The count sits beside the link, not in it: the HX census names a link by its text, so
            a count inside would change the census each time an item moves group. */}
        {groups.map((group) => (
          <Text key={group.id} as="span" size="sm" tone="muted">
            <Link href={`#${group.id}`} tone="secondary" inline={false}>{group.title}</Link> · {group.items.length}
          </Text>
        ))}
      </nav>

      <div className="max-w-3xl">
        {groups.map((group) => (
          <RoadmapSection key={group.id} status={group.id} title={group.title} summary={group.summary} items={group.items} />
        ))}

        <aside aria-labelledby="roadmap-ask" className="mt-14 border-t border-[var(--sj-border)] pt-8">
          <Heading level={3} size="lg" id="roadmap-ask">Something missing?</Heading>
          <Text tone="muted" className="mt-2">
            Tell us what you'd cook with it: email{" "}
            <Link href={`mailto:${CONTACT_EMAIL}?subject=Spoonjoy%20roadmap`}>{CONTACT_EMAIL}</Link>. A person
            reads every message.
          </Text>
          <Button href="/signup" className="mt-5">Start your kitchen</Button>
        </aside>
      </div>
    </CookbookPage>
  );
}
