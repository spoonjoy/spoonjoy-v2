import { useEffect, useState } from "react";
import { Text } from "~/components/ouro/text/text";
import { Button } from "~/components/button";
import { toast } from "~/lib/ouro/toast";
import { Fieldset } from "~/components/ouro/field/fieldset";
import { Switch } from "~/components/ouro/switch/switch";
import { Dialog } from "~/components/ouro/dialog/dialog";
import {
  isPushSupported,
  isIosNonStandalone,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/lib/push-client";
import { SettingsPanel } from "~/components/cookbook/page";

export interface NotificationPreferenceFlags {
  notifySpoonOnMyRecipe: boolean;
  notifyForkOfMyRecipe: boolean;
  notifyCookbookSaveOfMine: boolean;
  notifyFellowChefOriginCook: boolean;
}

const DEFAULT_PREFS: NotificationPreferenceFlags = {
  notifySpoonOnMyRecipe: true,
  notifyForkOfMyRecipe: true,
  notifyCookbookSaveOfMine: true,
  notifyFellowChefOriginCook: true,
};

export interface NotificationsSectionProps {
  initiallySubscribed: boolean;
  initialPreferences?: NotificationPreferenceFlags;
}

const FAILURE_COPY: Record<string, string> = {
  permission_denied: "Permission was denied — re-enable notifications in your browser to continue.",
  permission_dismissed: "Notifications need permission. Tap Enable again to try once more.",
  unsupported: "Notifications are not available on this browser.",
  public_key_unavailable: "Unable to enable notifications right now (server key unavailable).",
  server_error: "Unable to enable notifications right now (server error). Please try again.",
};

const PREF_LABELS: Array<{
  key: keyof NotificationPreferenceFlags;
  label: string;
}> = [
  { key: "notifySpoonOnMyRecipe", label: "Spoons on my recipes" },
  { key: "notifyForkOfMyRecipe", label: "Forks of my recipes" },
  { key: "notifyCookbookSaveOfMine", label: "Saves to cookbooks" },
  { key: "notifyFellowChefOriginCook", label: "Origin cooks by fellow chefs" },
];

export function NotificationsSection({
  initiallySubscribed,
  initialPreferences,
}: NotificationsSectionProps) {
  const [support, setSupport] = useState<ReturnType<typeof isPushSupported>>({
    supported: true,
  });
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferenceFlags>(
    initialPreferences ?? DEFAULT_PREFS,
  );
  const [iosDialogOpen, setIosDialogOpen] = useState(false);

  useEffect(() => {
    setSupport(isPushSupported());
  }, []);

  if (!support.supported) {
    return (
      <SettingsPanel title="Notifications">
        <Text tone="muted" className="mt-2">
          Not supported on this browser ({support.reason}).
        </Text>
      </SettingsPanel>
    );
  }

  async function onEnable() {
    if (isIosNonStandalone()) {
      setIosDialogOpen(true);
      return;
    }
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        setSubscribed(true);
        toast("Notifications enabled.", { tone: "success" });
      } else {
        const msg = FAILURE_COPY[result.reason] ?? "Unable to enable notifications.";
        toast(msg, { tone: "destructive" });
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
        toast("Notifications disabled.");
      } else {
        toast("Unable to disable notifications. Please try again.", { tone: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePreference(
    key: keyof NotificationPreferenceFlags,
    nextValue: boolean,
  ) {
    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: nextValue }));
    try {
      const res = await fetch("/api/push/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: nextValue }),
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
    } catch {
      // Rollback on failure.
      setPrefs((p) => ({ ...p, [key]: previous }));
      toast("Unable to update notification preferences. Please try again.", { tone: "destructive" });
    }
  }

  return (
    <SettingsPanel title="Notifications">
      {subscribed ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Text tone="muted">Notifications enabled.</Text>
          <Button type="button" plain onClick={onDisable} disabled={busy}>
            Disable
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Text tone="muted">Get a ping when fellow chefs cook, fork, or save your recipes.</Text>
          <Button type="button" onClick={onEnable} disabled={busy}>
            Enable notifications
          </Button>
        </div>
      )}

      <Fieldset legend="What to notify me about" className="mt-6 gap-3">
        {PREF_LABELS.map(({ key, label }) => (
          <Switch
            key={key}
            label={label}
            checked={prefs[key]}
            disabled={!subscribed}
            onCheckedChange={(next) => onTogglePreference(key, next)}
          />
        ))}
      </Fieldset>

      <Dialog
        open={iosDialogOpen}
        onOpenChange={setIosDialogOpen}
        title="Add Spoonjoy to your Home Screen first"
        description="Tap Share → Add to Home Screen, then open Spoonjoy from your Home Screen and try again."
        footer={(
          <Button type="button" onClick={() => setIosDialogOpen(false)}>
            Got it
          </Button>
        )}
      >{null}</Dialog>
    </SettingsPanel>
  );
}
