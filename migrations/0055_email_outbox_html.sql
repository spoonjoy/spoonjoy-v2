-- QA's captured account mail keeps its HTML part as well as its text, so journeys can show the mail
-- as a person sees it (app/lib/transactional-email.server.ts, capture mode). Production never
-- writes EmailOutbox.
--
-- Additive. Reversible: only capture mode names this column, so rolling back is
--   ALTER TABLE "EmailOutbox" DROP COLUMN "htmlBody";
-- and the previous Worker never names it.
ALTER TABLE "EmailOutbox" ADD COLUMN "htmlBody" TEXT;
