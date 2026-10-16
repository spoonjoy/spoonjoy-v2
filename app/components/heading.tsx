import { Heading as OuroHeading, type HeadingProps } from "~/components/ouro/text/heading";

type AppHeadingProps = Omit<HeadingProps, "level"> & { level?: HeadingProps["level"] };

export function Heading({ level = 1, size = "xl", ...props }: AppHeadingProps) {
  return <div className="contents font-sj-display"><OuroHeading {...props} level={level} size={size} /></div>;
}

export function Subheading({ level = 2, size = "sm", ...props }: AppHeadingProps) {
  return <div className="contents font-sj-display"><OuroHeading {...props} level={level} size={size} /></div>;
}
