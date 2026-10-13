import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type FormEvent } from "react";
import { Button } from "~/components/ouro/button/button";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { Select } from "~/components/ouro/select/select";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const surface = {
  background: "var(--background)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: "calc(var(--radius) + 4px)",
  padding: 24,
  maxWidth: 420,
};

/** A stand-in for a server action: it answers on the next tick, with errors for a taken name. */
function useAction() {
  const [errors, setErrors] = useState<FormErrors | undefined>();
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    setTimeout(() => {
      const next = name.toLowerCase() === "pasta" ? { name: "You already have a recipe called Pasta." } : undefined;
      setErrors(next);
      setSaved(!next);
    });
  };
  return { errors, saved, submit };
}

const meta = {
  title: "Forms/Form",
  component: Form,
  parameters: { layout: "padded" },
  args: { children: null },
} satisfies Meta<typeof Form>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Submit with the name "Pasta": the action's error lands on the name, and focus moves there. */
export const ServerErrors: Story = {
  render: function Render() {
    const { errors, saved, submit } = useAction();
    return (
      <div style={surface}>
        <Form method="post" errors={errors} onSubmit={submit}>
          <TextField label="Name" name="name" required defaultValue="Pasta" />
          <Select label="Course" name="course" defaultValue="main" options={[{ value: "starter", label: "Starter" }, { value: "main", label: "Main" }]} />
          <TextArea label="Notes" name="notes" description="Only you see these." />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button type="submit">Save recipe</Button>
            {saved && <span role="status">Saved.</span>}
          </div>
        </Form>
      </div>
    );
  },
};

/** The browser's own checks run first: an empty required field or a bad email stops the submit. */
export const Validation: Story = {
  render: () => (
    <div style={surface}>
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField label="Email" name="email" type="email" required />
        <TextField label="Recipe link" name="url" type="url" />
        <Button type="submit">Share</Button>
      </Form>
    </div>
  ),
};

/** Errors from the server, as an app renders them after a submit with JavaScript off. */
export const WithErrors: Story = {
  parameters: { screenshot: { name: "form-errors" } },
  render: () => (
    <div style={surface}>
      <Form method="post" errors={{ email: "That email is already in use.", course: "Choose a course." }}>
        <TextField label="Email" name="email" type="email" defaultValue="ari@example.com" description="We send the shopping list here." />
        <Select label="Course" name="course" placeholder="Choose a course" options={[{ value: "main", label: "Main" }]} />
        <Button type="submit">Save</Button>
      </Form>
    </div>
  ),
};
