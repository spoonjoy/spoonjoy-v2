-- Each Apple device keeps its push token sealed (AES-GCM under a key derived from the deployment's SESSION_SECRET,
-- app/lib/native-push-token.server.ts), so the server can send to it through the push relay (docs/push-relay.md).
-- tokenHash stays: registration still matches a token across accounts by its hash. A device registered before this
-- has no sealed token, so it gets no notifications until notifications are turned on again in the app's Settings.
--
-- Additive. Reversible: only native push names this column, so rolling back is
--   ALTER TABLE "NativePushDevice" DROP COLUMN "sealedToken";
-- and the previous Worker never names it.
ALTER TABLE "NativePushDevice" ADD COLUMN "sealedToken" TEXT;
