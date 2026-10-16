import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import {
  Menu,
  MenuBar,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from "~/components/ouro/menu/menu";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const card: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 280,
  height: 160,
  borderRadius: 12,
  border: "1px dashed var(--border)",
  color: "var(--muted-foreground)",
  fontSize: 14,
};

const noop = () => {};

const meta = {
  title: "Menus/Menu",
  component: Menu,
  parameters: { layout: "centered" },
  args: { trigger: <Button variant="outline" tone="secondary">Actions</Button> },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "bottom", "left", "right"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
    items: { table: { disable: true } },
  },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A dropdown with shortcuts, a group, a submenu and a destructive item. Below 640px it is a bottom sheet. */
export const Playground: Story = {
  parameters: { screenshot: { name: "menu-open", open: true } },
  args: {
    children: (
      <>
        <MenuGroup label="Recipe">
          <MenuItem onClick={noop} shortcut={["mod", "e"]}>
            Edit
          </MenuItem>
          <MenuItem onClick={noop} shortcut={["mod", "d"]}>
            Duplicate
          </MenuItem>
          <MenuItem href="#print">Print</MenuItem>
        </MenuGroup>
        <MenuSub label="Share">
          <MenuItem onClick={noop}>Copy link</MenuItem>
          <MenuItem onClick={noop}>Email</MenuItem>
        </MenuSub>
        <MenuSeparator />
        <MenuItem tone="destructive" onClick={noop} shortcut={["mod", "backspace"]}>
          Delete
        </MenuItem>
      </>
    ),
  },
};

/** The same entries as `items` data. */
export const Items: Story = {
  args: {
    items: [
      { label: "Edit", onClick: noop, shortcut: ["mod", "e"] },
      { label: "Open in new tab", href: "#recipe" },
      { type: "separator" },
      { type: "checkbox", label: "Pin to top", defaultChecked: true },
      { type: "submenu", label: "Move to", items: [{ label: "Weeknight" }, { label: "Baking" }] },
      { type: "separator" },
      { label: "Delete", tone: "destructive", onClick: noop },
    ],
  },
};

/** Checkbox items and a radio group keep the menu open, and their labels line up with the others. */
export const Settings: Story = {
  render: function Render() {
    const [notes, setNotes] = useState(true);
    const [sort, setSort] = useState("name");
    return (
      <Menu trigger={<Button variant="outline" tone="secondary">View</Button>}>
        <MenuCheckboxItem checked={notes} onCheckedChange={setNotes}>
          Show notes
        </MenuCheckboxItem>
        <MenuCheckboxItem shortcut={["mod", "shift", "i"]}>Show ingredients</MenuCheckboxItem>
        <MenuSeparator />
        <MenuRadioGroup label="Sort by" value={sort} onValueChange={setSort}>
          <MenuRadioItem value="name">Name</MenuRadioItem>
          <MenuRadioItem value="date">Date added</MenuRadioItem>
        </MenuRadioGroup>
      </Menu>
    );
  },
};

/** An icon button with a Tooltip: the Tooltip goes inside `trigger`. */
export const IconTrigger: Story = {
  render: () => (
    <Menu
      trigger={
        <Tooltip content="More actions">
          <Button aria-label="More actions" variant="plain" tone="secondary">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </Button>
        </Tooltip>
      }
    >
      <MenuItem onClick={noop}>Rename</MenuItem>
      <MenuItem tone="destructive" onClick={noop}>
        Delete
      </MenuItem>
    </Menu>
  ),
};

/** Right-click the area, or long-press it on a touch screen. The menu opens at the pointer. */
export const ContextMenu: Story = {
  render: () => (
    <Menu contextTrigger={<div style={card}>Right-click or long-press here</div>}>
      <MenuItem onClick={noop} shortcut={["mod", "c"]}>
        Copy
      </MenuItem>
      <MenuItem onClick={noop}>Add to cookbook</MenuItem>
      <MenuSeparator />
      <MenuItem tone="destructive" onClick={noop}>
        Remove
      </MenuItem>
    </Menu>
  ),
};

/** A menubar: the arrow keys move between menus, and hovering switches once one is open. */
export const Bar: Story = {
  render: () => (
    <MenuBar aria-label="Recipe editor">
      <Menu label="File">
        <MenuItem onClick={noop} shortcut={["mod", "n"]}>
          New recipe
        </MenuItem>
        <MenuItem onClick={noop} shortcut={["mod", "s"]}>
          Save
        </MenuItem>
      </Menu>
      <Menu label="Edit">
        <MenuItem onClick={noop} shortcut={["mod", "z"]}>
          Undo
        </MenuItem>
        <MenuItem onClick={noop} shortcut={["mod", "shift", "z"]}>
          Redo
        </MenuItem>
      </Menu>
      <Menu label="View">
        <MenuCheckboxItem defaultChecked>Show photos</MenuCheckboxItem>
      </Menu>
    </MenuBar>
  ),
};
