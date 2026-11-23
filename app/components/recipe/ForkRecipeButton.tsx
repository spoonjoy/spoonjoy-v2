import { useState } from "react";
import { useFetcher } from "react-router";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Button } from "~/components/ouro/button/button";
import { Text } from "~/components/ouro/text/text";

export interface ForkRecipeButtonProps {
  recipeId: string;
  recipeTitle: string;
  sourceChefUsername: string;
  isOwner: boolean;
  triggerTestId?: string;
}

export function ForkRecipeButton({
  recipeId,
  recipeTitle,
  sourceChefUsername,
  isOwner,
  triggerTestId,
}: ForkRecipeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" tone="secondary" onClick={() => setIsOpen(true)} data-testid={triggerTestId}>
        {isOwner ? "Make a variation" : "Fork"}
      </Button>
      <ForkRecipeDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        recipeId={recipeId}
        recipeTitle={recipeTitle}
        sourceChefUsername={sourceChefUsername}
        isOwner={isOwner}
      />
    </>
  );
}

export interface ForkRecipeDialogProps extends Omit<ForkRecipeButtonProps, "triggerTestId"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The fork (or, for the owner, make-a-variation) confirmation on its own, for a trigger that can't hold it, such as
 * a menu item, whose popup closes before the dialog opens.
 */
export function ForkRecipeDialog({
  recipeId,
  recipeTitle,
  sourceChefUsername,
  isOwner,
  open,
  onOpenChange,
}: ForkRecipeDialogProps) {
  // One fork per opening of the dialog: a double submit or a resubmit carries the same token, and
  // the server makes one fork for it.
  // It is made when the dialog opens (in the browser), never during server rendering.
  const [forkToken, setForkToken] = useState("");
  // A fetcher, so a fork the server could not save leaves the dialog open with its message (the
  // token stays, so trying again cannot make a second fork); a fork that succeeds redirects to it.
  const fetcher = useFetcher<{ error?: unknown }>();
  const [submittedToken, setSubmittedToken] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState(false);
  // A new token each time the dialog opens, set while rendering so the first frame already carries it.
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setForkToken(crypto.randomUUID());
      setSubmittedToken(null);
    }
  }
  const failure = submittedToken === forkToken && fetcher.state === "idle" && typeof fetcher.data?.error === "string"
    ? fetcher.data.error
    : null;

  const submitLabel = isOwner ? "Make variation" : "Fork";
  const dialogTitle = isOwner
    ? `Make a variation of "${recipeTitle}"?`
    : `Fork "${recipeTitle}"?`;
  const dialogBody = isOwner ? (
    <>Create a new copy of this recipe (a variation of <strong>{recipeTitle}</strong>) in your kitchen.</>
  ) : (
    <>Clone <strong>{recipeTitle}</strong> by <strong>{sourceChefUsername}</strong> into your kitchen. You can edit your fork independently from the original.</>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" title={dialogTitle}
      footer={<>
        <Button variant="outline" tone="secondary" type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <fetcher.Form method="post" action={`/recipes/${recipeId}/fork`} onSubmit={() => setSubmittedToken(forkToken)}>
          <input type="hidden" name="forkToken" value={forkToken} />
          <Button type="submit" disabled={fetcher.state !== "idle"}>{submitLabel}</Button>
        </fetcher.Form>
      </>}>
      <div>
        {dialogBody}
        {failure ? (
          <Text role="alert" tone="destructive" size="sm" className="mt-3">
            {failure}
          </Text>
        ) : null}
      </div>
    </Dialog>
  );
}
