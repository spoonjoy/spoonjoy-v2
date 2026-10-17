import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form, useActionData } from "react-router";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Button } from "~/components/button";
import { createTestRoutesStub } from "../../utils";

describe("released rich Dialog with Spoonjoy actions and real Router forms", () => {
  const writes: Array<Record<string, FormDataEntryValue>> = [];
  function Page() {
    const [open, setOpen] = useState(false);
    const answer = useActionData() as { saved?: boolean } | undefined;
    return <>
      <Button onClick={() => setOpen(true)}>Edit</Button>
      <p role="status">{answer?.saved ? "Saved answer" : "No answer"}</p>
      <Dialog open={open} onOpenChange={setOpen} title="Edit recipe" description="Update your recipe.">
        <Form method="post">
          <label htmlFor="recipe-name">Recipe name</label>
          <input id="recipe-name" name="title" defaultValue="Rice" />
          <Button type="submit">Save recipe</Button>
          <Button plain onClick={() => setOpen(false)}>Cancel edit</Button>
        </Form>
      </Dialog>
    </>;
  }
  function setup() {
    writes.length = 0;
    const Stub = createTestRoutesStub([{
      path: "/", Component: Page,
      action: async ({ request }: { request: Request }) => {
        writes.push(Object.fromEntries(await request.formData()));
        return { saved: true };
      },
    }]);
    return render(<Stub initialEntries={["/"]} />);
  }
  it("keeps the real title, description, control label and submit protocol", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit recipe" });
    expect(dialog).toHaveAccessibleDescription("Update your recipe.");
    expect(within(dialog).getByLabelText("Recipe name")).toHaveValue("Rice");
    expect(writes).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText("Recipe name"), { target: { value: "Beans" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Saved answer");
    expect(writes).toEqual([{ title: "Beans" }]);
  });
  it("cancels and reopens without submitting a form or losing its name", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel edit" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Edit recipe" })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });
  it("closes on actual keyboard Escape without mutating the Router action", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit recipe" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual([]);
  });
});
