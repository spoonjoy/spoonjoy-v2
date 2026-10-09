-- Who started an agent connection request, shown on the approval page so the chef can tell
-- whether the request came from their own agent. All self-reported by the network, never verified.
ALTER TABLE "AgentConnectionRequest" ADD COLUMN "requesterIp" TEXT;
ALTER TABLE "AgentConnectionRequest" ADD COLUMN "requesterUserAgent" TEXT;
ALTER TABLE "AgentConnectionRequest" ADD COLUMN "requesterCountry" TEXT;
