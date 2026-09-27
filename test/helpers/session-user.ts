import { getLocalDb } from "~/lib/db.server";

/**
 * Session reads check that the cookie's user exists and that its session version is current,
 * so a test that signs in with a literal user id needs that user in the test database.
 * Returns a function that removes the user again.
 */
export async function ensureSessionUser(id: string, sessionVersion = 0): Promise<() => Promise<void>> {
  const db = await getLocalDb();
  await db.user.upsert({
    where: { id },
    update: { sessionVersion },
    create: { id, email: `${id}@session-user.test`, username: `session_user_${id}`, sessionVersion },
  });
  return async () => {
    await db.user.deleteMany({ where: { id } });
  };
}
