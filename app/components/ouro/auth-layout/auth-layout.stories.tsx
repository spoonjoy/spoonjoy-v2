import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthLayout } from "~/components/ouro/auth-layout/auth-layout";
import { Button } from "~/components/ouro/button/button";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/ouro/text/text";

const form = (
  <Form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
    <TextField label="Email" name="email" type="email" autoComplete="email" required />
    <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
    <Button type="submit" fullWidth>
      Sign in
    </Button>
  </Form>
);

const meta = {
  title: "Navigation/AuthLayout",
  component: AuthLayout,
  parameters: { layout: "fullscreen" },
  args: { title: "Sign in", children: form },
} satisfies Meta<typeof AuthLayout>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A sign-in page: brand, title, the form, and the link to the other form under the card. */
export const InContext: Story = {
  args: {
    description: "Welcome back to your kitchen.",
    brand: (
      <Text>
        <strong>Spoonjoy</strong>
      </Text>
    ),
    footer: (
      <>
        New here? <Link href="#signup">Create an account</Link>
      </>
    ),
  },
  parameters: { screenshot: { name: "auth-layout" } },
};
