import { Avatar } from '../ouro/avatar/avatar'
import { Badge } from '../ouro/badge/badge'
import { Button } from '../button'
import { Heading } from '~/components/ouro/text/heading'
import { Link } from '../navigation/app-link'
import { Text } from '~/components/ouro/text/text'
import { resolveChefAvatarUrl } from '~/lib/chef-avatar'

export interface BioCardProps {
  name: string
  bio: string
  recipeCount: number
  cookbookCount: number
  avatarUrl?: string
  profileHref?: string
  location?: string
  joinedLabel?: string
  onEditProfile?: () => void
}

export function BioCard({
  name,
  bio,
  recipeCount,
  cookbookCount,
  avatarUrl,
  profileHref,
  location,
  joinedLabel,
  onEditProfile,
}: BioCardProps) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <section className="border-y border-[var(--sj-border)] py-5">
      <div className="flex items-start gap-3">
        <Avatar
          name={name}
          src={resolveChefAvatarUrl(avatarUrl)}
          initials={initials}
          alt={name}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          {profileHref ? (
            <Link href={profileHref} className="no-underline hover:text-[var(--sj-tomato)]">
              <Heading level={2} size="xl" className="truncate">
                {name}
              </Heading>
            </Link>
          ) : (
            <Heading level={2} size="xl" className="truncate">
              {name}
            </Heading>
          )}

          {(location || joinedLabel) && (
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui mt-1 text-xs uppercase tracking-[0.14em]">
              {[location, joinedLabel].filter(Boolean).join(' • ')}
            </p>
          )}
        </div>
      </div>

      <Text tone="muted" size="sm" className="mt-4 leading-6">{bio}</Text>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="soft">{recipeCount} recipes</Badge>
        <Badge tone="warning" variant="soft">{cookbookCount} cookbooks</Badge>
      </div>

      {onEditProfile && (
        <div className="mt-5">
          <Button plain onClick={onEditProfile} className="w-full justify-center">
            Edit profile
          </Button>
        </div>
      )}

      <div className="mt-5 border-t border-[var(--sj-border)] pt-4">
        <h3 className="font-sj-display text-base/7 font-semibold tracking-normal text-[var(--sj-ink)] text-sm">
          Kitchen Snapshot
        </h3>
        <p className="text-base/6 text-[var(--sj-ink-soft)] mt-1 text-xs">
          Keeping your pantry fresh with small-batch recipes and practical weeknight staples.
        </p>
      </div>
    </section>
  )
}
