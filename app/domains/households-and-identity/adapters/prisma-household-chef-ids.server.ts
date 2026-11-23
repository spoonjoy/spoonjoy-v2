// chefIdsSharingWith on Prisma, for readers with no D1 binding (unit tests, scripts). Same answer as the D1 store's.
import type { PrismaClient } from "@prisma/client";

export type HouseholdMemberReader = { householdMember: Pick<PrismaClient["householdMember"], "findMany"> };

/** The other users who share at least one household with this one. */
export async function prismaHouseholdChefIds(db: HouseholdMemberReader, userId: string): Promise<Set<string>> {
  const rows = await db.householdMember.findMany({
    where: { userId: { not: userId }, household: { members: { some: { userId } } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return new Set(rows.map((row) => row.userId));
}
