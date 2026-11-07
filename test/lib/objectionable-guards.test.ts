// Every write path that takes free text refuses objectionable terms (App Store guideline 1.2),
// and a chef who blocked another hears nothing from them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import { enqueueNotification } from "~/lib/notification-dispatch.server";
import { OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";
import { SpoonValidationError, prepareSpoonContent, updateSpoon } from "~/lib/recipe-spoon.server";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { validateDescription, validateStepDescription, validateStepTitle, validateTitle } from "~/lib/validation";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

const BAD = "free porn";
const REFUSED = { valid: false, error: OBJECTIONABLE_CONTENT_MESSAGE };

describe("objectionable-content guards", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("refuses objectionable recipe titles, descriptions and steps", async () => {
    expect(validateTitle(BAD)).toEqual(REFUSED);
    expect(validateDescription(BAD)).toEqual(REFUSED);
    expect(validateStepTitle(BAD)).toEqual(REFUSED);
    expect(validateStepDescription(BAD)).toEqual(REFUSED);
    expect(await validateActiveRecipeTitleUnique(db, { chefId: "nobody", title: BAD })).toEqual(REFUSED);
  });

  it("refuses objectionable cook-log notes, new or edited", async () => {
    await expect(prepareSpoonContent({ chefId: "c", recipeId: "r", note: BAD }, {})).rejects.toThrow(SpoonValidationError);
    await expect(prepareSpoonContent({ chefId: "c", recipeId: "r", nextTime: BAD }, {})).rejects.toThrow(OBJECTIONABLE_CONTENT_MESSAGE);

    const chef = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({ data: createTestRecipe(chef.id) });
    const spoon = await db.recipeSpoon.create({ data: { recipeId: recipe.id, chefId: chef.id, cookedAt: new Date(), note: "Good" } });
    await expect(updateSpoon(db, spoon.id, chef.id, { note: BAD })).rejects.toThrow(OBJECTIONABLE_CONTENT_MESSAGE);
    await expect(updateSpoon(db, spoon.id, chef.id, { nextTime: BAD })).rejects.toThrow(OBJECTIONABLE_CONTENT_MESSAGE);
    expect((await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoon.id } })).note).toBe("Good");
  });

  it("sends nothing from a chef the recipient blocked", async () => {
    const recipient = await db.user.create({ data: createTestUser() });
    const actor = await db.user.create({ data: createTestUser() });
    await db.chefBlock.create({ data: { blockerId: recipient.id, blockedId: actor.id } });
    const sendPush = vi.fn();

    const result = await enqueueNotification(
      db,
      { recipientId: recipient.id, actorId: actor.id, kind: "spoon_on_my_recipe", payload: {} },
      { vapid: { publicKey: "p", privateKey: "k", subject: "mailto:ari@spoonjoy.app" }, sendPush },
    );

    expect(result).toEqual({ eventId: null, queuedSends: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(await db.notificationEvent.count()).toBe(0);
  });
});
