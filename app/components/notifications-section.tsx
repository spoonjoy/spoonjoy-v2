import { useState } from "react";
import { Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/lib/push-client";

export interface NotificationsSectionProps {
  initiallySubscribed: boolean;
}

const FAILURE_COPY: Record<string, string> = {
  permission_denied: "Permission was denied — re-enable notifications in your browser to continue.",
  permission_dismissed: "Notifications need permission. Tap Enable again to try once more.",
  unsupported: "Notifications are not available on this browser.",
  public_key_unavailable: "Unable to enable notifications right now (server key unavailable).",
  server_error: "Unable to enable notifications right now (server error). Please try again.",
};

export function NotificationsSection({ initiallySubscribed }: NotificationsSectionProps) {
  const support = isPushSupported();
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  if (!support.supported) {
    return (
      <section className="sj-panel mt-8 rounded-[2rem] p-6">
        <Subheading className="text-2xl/8">Notifications</Subheading>
        <Text className="mt-2">
          Not supported on this browser ({support.reason}).
        </Text>
      </section>
    );
  }

  async function onEnable() {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        setSubscribed(true);
        showToast({ message: "Notifications enabled." });
      } else {
        const msg = FAILURE_COPY[result.reason] ?? "Unable to enable notifications.";
        showToast({ message: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      const result = await unsubscribeFromPush();
      if (result.ok) {
        setSubscribed(false);
        showToast({ message: "Notifications disabled." });
      } else {
        showToast({ message: "Unable to disable notifications. Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sj-panel mt-8 rounded-[2rem] p-6">
      <Subheading className="text-2xl/8">Notifications</Subheading>
      {subscribed ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Text>Notifications enabled.</Text>
          <Button type="button" plain onClick={onDisable} disabled={busy}>
            Disable
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Text>Get a ping when fellow chefs cook, fork, or save your recipes.</Text>
          <Button type="button" onClick={onEnable} disabled={busy}>
            Enable notifications
          </Button>
        </div>
      )}
    </section>
  );
}
