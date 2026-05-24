import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHEF_AVATAR_URL,
  isGeneratedChefAvatarUrl,
  resolveChefAvatarUrl,
} from "~/lib/chef-avatar";

describe("chef-avatar", () => {
  it("uses the Chef RJ fallback when no avatar is set", () => {
    expect(resolveChefAvatarUrl(null)).toBe(DEFAULT_CHEF_AVATAR_URL);
    expect(resolveChefAvatarUrl(undefined)).toBe(DEFAULT_CHEF_AVATAR_URL);
    expect(resolveChefAvatarUrl("   ")).toBe(DEFAULT_CHEF_AVATAR_URL);
  });

  it("replaces generated Dicebear placeholders with Chef RJ", () => {
    const dicebearUrl = "https://api.dicebear.com/7.x/initials/svg?seed=DC";
    const dicebearSubdomainUrl = "https://avatars.dicebear.com/7.x/initials/svg?seed=DC";

    expect(isGeneratedChefAvatarUrl(dicebearUrl)).toBe(true);
    expect(isGeneratedChefAvatarUrl(dicebearSubdomainUrl)).toBe(true);
    expect(resolveChefAvatarUrl(dicebearUrl)).toBe(DEFAULT_CHEF_AVATAR_URL);
  });

  it("keeps intentional uploaded or external profile photos", () => {
    expect(isGeneratedChefAvatarUrl("https://example.com/profile.jpg")).toBe(false);
    expect(resolveChefAvatarUrl(" https://example.com/profile.jpg ")).toBe("https://example.com/profile.jpg");
  });

  it("does not treat malformed custom paths as generated placeholders", () => {
    expect(isGeneratedChefAvatarUrl(null)).toBe(false);
    expect(isGeneratedChefAvatarUrl(undefined)).toBe(false);
    expect(isGeneratedChefAvatarUrl("http://[")).toBe(false);
    expect(isGeneratedChefAvatarUrl("/photos/profiles/user/avatar.png")).toBe(false);
    expect(resolveChefAvatarUrl("/photos/profiles/user/avatar.png")).toBe("/photos/profiles/user/avatar.png");
  });
});
