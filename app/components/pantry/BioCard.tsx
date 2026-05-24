import { Avatar } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Heading, Subheading } from '../ui/heading'
import { Link } from '../ui/link'
import { Text } from '../ui/text'
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
          src={resolveChefAvatarUrl(avatarUrl)}
          initials={initials}
          alt={name}
          className="size-16 border border-[var(--sj-border)] bg-[var(--sj-flour)] text-[var(--sj-ink)] shadow-[var(--sj-shadow-soft)]"
        />
        <div className="min-w-0 flex-1">
          {profileHref ? (
            <Link href={profileHref} className="no-underline hover:text-[var(--sj-tomato)]">
              <Heading level={2} className="truncate text-2xl/8 font-semibold">
                {name}
              </Heading>
            </Link>
          ) : (
            <Heading level={2} className="truncate text-2xl/8 font-semibold">
              {name}
            </Heading>
          )}

          {(location || joinedLabel) && (
            <Text className="font-sj-ui mt-1 text-xs uppercase tracking-[0.14em]">
              {[location, joinedLabel].filter(Boolean).join(' • ')}
            </Text>
          )}
        </div>
      </div>

      <Text className="mt-4 text-sm/6">{bio}</Text>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge color="zinc">{recipeCount} recipes</Badge>
        <Badge color="amber">{cookbookCount} cookbooks</Badge>
      </div>

      {onEditProfile && (
        <div className="mt-5">
          <Button plain onClick={onEditProfile} className="w-full justify-center">
            Edit Profile
          </Button>
        </div>
      )}

      <div className="mt-5 border-t border-[var(--sj-border)] pt-4">
        <Subheading level={3} className="text-sm">
          Kitchen Snapshot
        </Subheading>
        <Text className="mt-1 text-xs">
          Keeping your pantry fresh with small-batch recipes and practical weeknight staples.
        </Text>
      </div>
    </section>
  )
}
