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
          onClick={() => setIsOpen(true)}
          className={triggerClassName}
          data-testid={triggerTestId}
        >
          {triggerLabel}
        </button>
      ) : (
        <Button
          type="button"
          plain
          onClick={() => setIsOpen(true)}
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
            <Button type="submit">{submitLabel}</Button>
          </Form>
        </DialogActions>
      </Dialog>
    </>
  );
}
