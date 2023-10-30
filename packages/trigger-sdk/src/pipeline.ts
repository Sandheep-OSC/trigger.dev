import { TriggerMetadata } from "@trigger.dev/core";
import { EventSpecification, Trigger } from "./types";
import { EventFilter } from "@trigger.dev/core";
import { TriggerClient } from "./triggerClient";
import { Job } from "./job";

export class PipelineStep<TInput extends any, TOutput extends any> {
  #callback: PipelineStepCallback<TInput, TOutput>;

  constructor(options: PipelineStepOptions<TInput, TOutput>) {
    this.#callback = options.callback;
  }

  call(input: TInput) {
    return this.#callback(input);
  }
}

export class TriggerPipeline<TSteps extends PipelineSteps<any, any>> {
  #steps: TSteps;
  #resources: Record<string, any>;

  constructor(steps: TSteps, resources?: Record<string, any>) {
    this.#steps = steps;
    this.#resources = resources ?? {};
  }

  async call(input: InferPipelineInput<TSteps>): Promise<InferPipelineOutput<TSteps>> {
    let output = input;
    for (const step of this.#steps) {
      output = await step.call(output);
    }
    return output as InferPipelineOutput<TSteps>;
  }
}

type StepsWithFirst<TInput extends any, TOutput extends any> = [
  PipelineStep<TInput, TOutput>,
  ...PipelineStep<any, any>[],
];

type StepsWithLast<TInput extends any, TOutput extends any> = [
  ...PipelineStep<any, any>[],
  PipelineStep<TInput, TOutput>,
];

// TODO: enforce prev outputs -> current inputs
type PipelineSteps<TInput extends any, TOutput extends any> = StepsWithFirst<TInput, any> &
  StepsWithLast<any, TOutput>;

type InferPipelineInput<TSteps extends StepsWithFirst<any, any>> = TSteps extends StepsWithFirst<
  infer TInput,
  any
>
  ? TInput
  : never;

type InferPipelineOutput<TSteps extends StepsWithLast<any, any>> = TSteps extends StepsWithLast<
  any,
  infer TOutput
>
  ? TOutput
  : never;

type PipelineStepCallback<TInput extends any, TOutput extends any> = (
  input: TInput
) => Promise<TOutput>;

type PipelineStepOptions<TInput extends any, TOutput extends any> = {
  callback: PipelineStepCallback<TInput, TOutput>;
};

const runPipeline = async () => {
  const step1 = new PipelineStep({
    callback: async (input: Record<any, any>) => {
      return JSON.stringify(input);
    },
  });

  const output1 = step1.call({ foo: "bar" });

  const step2 = new PipelineStep({
    callback: async (input: string) => {
      const parsed = JSON.parse(input);
      if (parsed === "object" && parsed !== null) {
        return parsed as Record<any, any>;
      } else {
        throw Error("Could not parse as object");
      }
    },
  });

  const output2 = step2.call(await output1);

  const pipeline = new TriggerPipeline([
    step1,
    step2,
    new PipelineStep({ callback: async (input: Record<any, any>) => input }),
  ]);

  const res = await pipeline.call({ bar: "baz" });
};

type PipelineWithTrigger<TEvent extends any, TOutput extends any> = {
  trigger: Trigger<EventSpecification<TEvent>>;
  pipeline: TriggerPipeline<PipelineSteps<TEvent, TOutput>>;
};

type TriggerOptions<TEventSpecification extends EventSpecification<any>> = {
  trigger: Trigger<TEventSpecification>;
  pipeline: TriggerPipeline<PipelineSteps<any, any>>;
  filter?: EventFilter;
};

class PipelineTrigger<TEventSpecification extends EventSpecification<any>>
  implements Trigger<TEventSpecification>
{
  constructor(private readonly options: TriggerOptions<TEventSpecification>) {}

  toJSON(): TriggerMetadata {
    return {
      type: "static",
      title: this.options.trigger.event.name,
      properties: this.options.trigger.event.properties,
      rule: {
        event: `pipeline.${this.options.trigger.event.name}`,
        payload: this.options.filter ?? {},
        source: this.options.trigger.event.source,
      },
    };
  }

  get event() {
    return this.options.trigger.event;
  }

  attachToJob(triggerClient: TriggerClient, job: Job<Trigger<TEventSpecification>, any>): void {}

  get preprocessRuns() {
    return false;
  }
}

type TriggerWithSteps<TInput extends any, TOutput extends any> = {
  input: TInput;
  steps: StepPipeline<TInput, TOutput>;
};

type PipeTriggerOutput<TTrigger extends TriggerWithSteps<any, any>> = Last<
  TTrigger["steps"]
> extends never
  ? TTrigger["input"]
  : Last<TTrigger["steps"]> extends PipelineStepOptions<any, infer TOutput>
  ? TOutput
  : never;

type StepPipeline<TInput extends any = any, TOutput extends any = any> = [
  PipelineStepOptions<TInput, any>,
  ...PipelineStepOptions<any, any>[],
  PipelineStepOptions<any, TOutput>,
];

type First<T extends readonly any[]> = T extends readonly [infer FirstElement, ...any[]]
  ? FirstElement
  : never;

type Last<T extends readonly any[]> = T extends readonly [...any[], infer LastElement]
  ? LastElement
  : never;
