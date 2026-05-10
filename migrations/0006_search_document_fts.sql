-- Full-text search index for Spoonjoy UI and Ouroboros MCP search.
-- The app also creates/rebuilds this table at runtime so local SQLite and D1 stay self-healing.
CREATE VIRTUAL TABLE IF NOT EXISTS "SearchDocument" USING fts5(
  entityType UNINDEXED,
  entityId UNINDEXED,
  ownerId UNINDEXED,
  ownerUsername UNINDEXED,
  sortAt UNINDEXED,
  title,
  subtitle,
  body,
  href UNINDEXED,
  imageUrl UNINDEXED,
  metadata UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
