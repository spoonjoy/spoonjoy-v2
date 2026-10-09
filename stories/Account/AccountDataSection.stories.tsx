import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountDataSection } from "../../app/components/account/AccountDataSection";
import Privacy from "../../app/routes/privacy";
import AccountDeleted from "../../app/routes/account.deleted";

const meta: Meta<typeof AccountDataSection> = {
  title: "Account/AccountDataSection",
  component: AccountDataSection,
  parameters: {
    docs: {
      description: {
        component:
          "The Your data section of account settings: download everything as JSON, or delete the account after typing the username and confirming it's you.",
      },
    },
  },
  decorators: [(Story) => <div className="mx-auto max-w-4xl px-4"><Story /></div>],
  args: { username: "ada", hasPassword: true, deleteError: null },
};

export default meta;
type Story = StoryObj<typeof AccountDataSection>;

export const Closed: Story = {};

export const WrongPassword: Story = {
  args: { deleteError: { error: "password_incorrect", message: "That password isn't right." } },
};

export const PasswordlessNeedsSignIn: Story = {
  args: {
    hasPassword: false,
    deleteError: { error: "recent_sign_in_required", message: "For your safety, sign in again, then delete your account within 10 minutes." },
  },
};

export const PrivacyPolicy: Story = { render: () => <Privacy /> };

export const AccountDeletedPage: Story = { render: () => <AccountDeleted /> };
