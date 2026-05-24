import { Subheading } from "~/components/ui/heading";

export type StepOutputUse = {
  id: string;
  outputStepNum: number;
  outputOfStep: {
    stepNum: number;
    stepTitle: string | null;
  };
};

type StepOutputUseDisplayProps = {
  usingSteps: StepOutputUse[];
};

export function StepOutputUseDisplay({ usingSteps }: StepOutputUseDisplayProps) {
  if (usingSteps.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 border-y border-[var(--sj-border)] py-4">
      <Subheading level={4} className="m-0 mb-3 text-sm uppercase text-[var(--sj-ink-soft)]">
        Using outputs from
      </Subheading>
      <ul className="m-0 pl-6">
        {usingSteps.map((use) => (
          <li key={use.id}>
            {use.outputOfStep.stepTitle
              ? `output of step ${use.outputStepNum}: ${use.outputOfStep.stepTitle}`
              : `output of step ${use.outputStepNum}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
