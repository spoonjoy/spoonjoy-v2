export const DEFAULT_CHEF_AVATAR_URL = "/images/chef-rj.png";

export function isGeneratedChefAvatarUrl(photoUrl: string | null | undefined): boolean {
  if (!photoUrl) {
    return false;
  }

  try {
    const url = new URL(photoUrl, "https://spoonjoy.local");
    return url.hostname === "api.dicebear.com" || url.hostname.endsWith(".dicebear.com");
  } catch {
    return false;
  }
}

export function resolveChefAvatarUrl(photoUrl: string | null | undefined): string {
  const trimmed = photoUrl?.trim();
  if (!trimmed || isGeneratedChefAvatarUrl(trimmed)) {
    return DEFAULT_CHEF_AVATAR_URL;
  }

  return trimmed;
}
