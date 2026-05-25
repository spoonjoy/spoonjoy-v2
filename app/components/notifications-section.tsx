import { useEffect, useState } from "react";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { Switch, SwitchField, SwitchGroup } from "~/components/ui/switch";
import { Label } from "~/components/ui/fieldset";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
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
  const { showToast } = useToast();

  useEffect(() => {
    setSupport(isPushSupported());
  }, []);

  if (!support.supported) {
    return (
      <SettingsPanel title="Notifications">
        <Text className="mt-2">
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
      showToast({
        message: "Unable to update notification preferences. Please try again.",
      });
    }
  }

  return (
    <SettingsPanel title="Notifications">
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

      <div className="mt-6">
        <Text className="text-sm font-medium">What to notify me about</Text>
        <SwitchGroup className="mt-3">
          {PREF_LABELS.map(({ key, label }) => (
            <SwitchField key={key}>
              <Label>{label}</Label>
              <Switch
                aria-label={label}
                checked={prefs[key]}
                disabled={!subscribed}
                onChange={(next) => onTogglePreference(key, next)}
              />
            </SwitchField>
          ))}
        </SwitchGroup>
      </div>

      <Dialog open={iosDialogOpen} onClose={setIosDialogOpen}>
        <DialogTitle>Add Spoonjoy to your Home Screen first</DialogTitle>
        <DialogDescription>
          Tap Share → Add to Home Screen, then open Spoonjoy from your Home Screen and try again.
        </DialogDescription>
        <DialogBody />
        <DialogActions>
          <Button type="button" onClick={() => setIosDialogOpen(false)}>
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsPanel>
  );
}
