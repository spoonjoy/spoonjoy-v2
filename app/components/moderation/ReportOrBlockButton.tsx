import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
import { Separator } from "~/components/ouro/separator/separator";
import { Text } from "~/components/ouro/text/text";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { toast } from "~/lib/ouro/toast";

// The report and block reasons the server accepts (app/lib/moderation.server.ts).
export const REPORT_REASON_OPTIONS = [
  { value: "offensive", label: "Offensive or objectionable" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "spam", label: "Spam" },
  { value: "copyright", label: "Copyright" },
  { value: "other", label: "Something else" },
] as const;

export interface ReportOrBlockButtonProps {
  /** What the report is about. */
  targetType: "recipe" | "chef" | "spoon" | "cookbook";
  targetId: string;
  /** The chef behind it, who can be blocked from the same dialog. */
  chefId: string;
  chefUsername: string;
  /** How the dialog names the content, such as "this recipe". */
  targetLabel: string;
  triggerTestId?: string;
}

type ActionAnswer = { intent?: string; success?: boolean; error?: string };

/**
 * One "Report" control: a dialog to report the content to Spoonjoy's moderators, and to block its
 * chef. Either one hides the content from this chef at once (the page reloads its data after).
 */
export function ReportOrBlockButton({ targetType, targetId, chefId, chefUsername, targetLabel, triggerTestId }: ReportOrBlockButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const fetcher = useFetcher<ActionAnswer>();
  const busy = fetcher.state !== "idle";
  const answer = fetcher.state === "idle" ? fetcher.data : undefined;
  const failure = answer && answer.success === false ? answer.error ?? "Something went wrong. Try again." : null;

  useEffect(() => {
    if (answer?.success !== true) return;
    setOpen(false);
    toast(
      answer.intent === "block"
        ? `You blocked @${chefUsername}. You won't see their recipes, cookbooks or cooks.`
        : "Thanks. Spoonjoy reviews every report within 24 hours, and you won't see this again.",
      { tone: "success" },
    );
  }, [answer, chefUsername]);

  return (
    <>
      <Button type="button" variant="outline" tone="secondary" onClick={() => setOpen(true)} data-testid={triggerTestId}>
        Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen} size="md" title={`Report ${targetLabel}`}>
        <fetcher.Form method="post" action="/moderation" className="grid gap-4">
          <input type="hidden" name="intent" value="report" />
          <input type="hidden" name="targetType" value={targetType} />
          <input type="hidden" name="targetId" value={targetId} />
          <RadioGroup
            legend="What's wrong?"
            name="reason"
            required
            value={reason}
            onValueChange={setReason}
            options={REPORT_REASON_OPTIONS.map((option) => ({ ...option }))}
          />
          <TextArea name="details" label="Anything else (optional)" rows={3} />
          {failure ? <Text role="alert" tone="destructive" size="sm">{failure}</Text> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !reason}>Send report</Button>
          </div>
        </fetcher.Form>
        <Separator className="my-5" />
        <fetcher.Form method="post" action="/moderation" className="grid gap-3">
          <input type="hidden" name="intent" value="block" />
          <input type="hidden" name="chefId" value={chefId} />
          <Text tone="muted" size="sm">
            Blocking @{chefUsername} hides their recipes, cookbooks, cooks and profile from you, and stops their notifications. You can unblock them in Settings.
          </Text>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" tone="destructive" disabled={busy}>Block @{chefUsername}</Button>
          </div>
        </fetcher.Form>
      </Dialog>
    </>
  );
}
