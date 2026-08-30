type MutationTiming = "before" | "after";

export function createDeterministicStaleReadRace<
  Contender extends string,
  Stage extends string,
>({
  contenders,
  winner,
  stage,
}: {
  contenders: readonly Contender[];
  winner: Contender;
  stage: Stage;
}) {
  const arrived = new Set<Contender>();
  let releaseAllArrived!: () => void;
  let releaseWinnerCommitted!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    releaseAllArrived = resolve;
  });
  const winnerCommitted = new Promise<void>((resolve) => {
    releaseWinnerCommitted = resolve;
  });

  return {
    hookFor(contender: Contender) {
      return async (observedStage: string, timing: MutationTiming): Promise<void> => {
        if (observedStage !== stage) return;
        if (timing === "after") {
          if (contender === winner) releaseWinnerCommitted();
          return;
        }

        arrived.add(contender);
        if (arrived.size === contenders.length) releaseAllArrived();
        if (contender === winner) {
          await allArrived;
        } else {
          await winnerCommitted;
        }
      };
    },
    arrivedContenders() {
      return contenders.filter((contender) => arrived.has(contender));
    },
  };
}
