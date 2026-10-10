import { useState } from "react";
import { Form } from "react-router";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";

export interface ForkRecipeButtonProps {
  recipeId: string;
  recipeTitle: string;
  sourceChefUsername: string;
  isOwner: boolean;
  triggerClassName?: string;
  triggerTestId?: string;
  triggerStyle?: "button" | "text";
}

export function ForkRecipeButton({
  recipeId,
  recipeTitle,
  sourceChefUsername,
  isOwner,
  triggerClassName,
  triggerTestId,
  triggerStyle = "button",
}: ForkRecipeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  // One fork per opening of the dialog: a double submit or a resubmit carries the same token, and
  // the server makes one fork for it.
  // It is made when the dialog opens (in the browser), never during server rendering.
  const [forkToken, setForkToken] = useState("");
  const open = () => {
    setForkToken(crypto.randomUUID());
    setIsOpen(true);
  };

  const triggerLabel = isOwner ? "Make a variation" : "Fork";
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
    <>
      {triggerStyle === "text" ? (
        <button
          type="button"
          onClick={open}
          className={triggerClassName}
          data-testid={triggerTestId}
        >
          {triggerLabel}
        </button>
      ) : (
        <Button
          type="button"
          plain
          onClick={open}
          className={triggerClassName}
          data-testid={triggerTestId}
        >
          {triggerLabel}
        </Button>
      )}
      <Dialog open={isOpen} onClose={setIsOpen} size="md">
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogBody>{dialogBody}</DialogBody>
        <DialogActions>
          <Button plain type="button" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Form method="post" action={`/recipes/${recipeId}/fork`}>
            <input type="hidden" name="forkToken" value={forkToken} />
            <Button type="submit">{submitLabel}</Button>
          </Form>
        </DialogActions>
      </Dialog>
    </>
  );
}
