// The meal plan in a calendar app: the cook's private link to their plan's iCal feed, made, copied, opened in their
// calendar app, replaced or turned off from one sheet. Only the link's hash is kept, so the link shows once, when it
// is made; after that the sheet says when it was made and offers a new one instead.
import { useState, type ReactNode } from "react";
import { CalendarPlus } from "lucide-react";
import { Form as RouterForm, useNavigation } from "react-router";
import { errorsFor, webcalUrl, type PlanActionAnswer } from "~/domains/planning";
import { Button } from "~/components/ouro/button/button";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";

const MAKE = "make-feed-link";
const REVOKE = "revoke-feed-link";

function FeedForm({ intent, children }: { intent: string; children: ReactNode }) {
  return (
    <RouterForm method="post">
      <input type="hidden" name="intent" value={intent} />
      {children}
    </RouterForm>
  );
}

/** What the last make or turn-off did, or "" when there is nothing to say. */
function feedResult(answer: PlanActionAnswer, freshUrl: string | null) {
  if (freshUrl) {
    const made = answer?.replaced ? "Made a new calendar link; the old one no longer works." : "Made your calendar link.";
    return `${made} Copy it now: Spoonjoy shows it only this once.`;
  }
  if (answer?.intent !== REVOKE || answer.revoked === undefined) return "";
  return answer.revoked ? "Turned off your calendar link. Calendars subscribed to it stop getting your plan." : "There was no calendar link to turn off.";
}

export type CalendarFeedProps = {
  /** When the cook's link was made, as an ISO instant, or null when they have none. */
  madeAt: string | null;
  answer: PlanActionAnswer;
};

/** The header's Add to calendar button, and the sheet it opens. */
export function CalendarFeed({ madeAt, answer }: CalendarFeedProps) {
  const [open, setOpen] = useState(false);
  // A link made in this visit shows until the sheet closes; reopened, the sheet treats it like any older link.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const navigation = useNavigation();
  // A form is being sent only while the navigation carries its data.
  const busy = navigation.formData?.get("intent");
  const madeNow = answer?.intent === MAKE && answer.feedUrl ? answer.feedUrl : null;
  const freshUrl = madeNow !== dismissed ? madeNow : null;
  const error = errorsFor(answer, MAKE)?.general ?? errorsFor(answer, REVOKE)?.general;
  const turnedOff = answer?.intent === REVOKE && answer.revoked !== undefined;

  // Only the button opens the sheet, so the sheet's own change is always a close.
  function close() {
    setDismissed(madeNow);
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" tone="secondary" size="sm" startIcon={CalendarPlus} onClick={() => setOpen(true)}>
        Add to calendar
      </Button>
      <Sheet
        open={open}
        onOpenChange={close}
        title="Add your meal plan to a calendar"
        description="A private link lets your calendar app show the meals you plan, from four weeks back to thirteen weeks ahead. Anyone with the link can see your plan, so give it only to your calendar."
        className="mx-auto max-w-lg"
      >
        {/* The link is a secret: analytics never records a click or an address inside this sheet. */}
        <div className="ph-no-capture grid gap-4">
          {/* One status line, there from the sheet's start, so a screen reader hears each change to it. */}
          <Text role="status">{feedResult(answer, freshUrl)}</Text>
          {error ? <Text role="alert" tone="destructive">{error}</Text> : null}
          {freshUrl ? (
            <>
              {/* The new link takes the focus from the button that made it, which is gone. */}
              <TextField label="Calendar link" value={freshUrl} readOnly autoFocus />
              <div className="flex flex-wrap gap-2">
                <Button href={webcalUrl(freshUrl)} size="sm">Open in calendar app</Button>
                <CopyButton value={freshUrl} label="Copy link" />
              </div>
              <Text size="sm" tone="muted">Using Google Calendar? Copy the link, then add it under Other calendars, From URL.</Text>
            </>
          ) : madeAt ? (
            <Text tone="muted">
              You made your link on <LocalDate value={madeAt} />. Spoonjoy can't show it again; to add your plan to
              another calendar, make a new link, and the old one stops working.
            </Text>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {freshUrl ? null : (
              <FeedForm intent={MAKE}>
                {/* After a turn-off, whose button is gone, the focus lands here. */}
                <Button type="submit" size="sm" loading={busy === MAKE} loadingLabel="Making a calendar link" autoFocus={turnedOff}>
                  {madeAt ? "Make a new link" : "Make a calendar link"}
                </Button>
              </FeedForm>
            )}
            {madeAt ? (
              <FeedForm intent={REVOKE}>
                <Button type="submit" variant="outline" tone="destructive" size="sm" loading={busy === REVOKE} loadingLabel="Turning off the calendar link">
                  Turn off link
                </Button>
              </FeedForm>
            ) : null}
          </div>
        </div>
      </Sheet>
    </>
  );
}
