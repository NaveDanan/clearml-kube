import {ClearpipeFunctionAuthoringCreateData} from './function-authoring.models';

export interface ClearpipeFunctionAuthoringCatalogPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly create: ClearpipeFunctionAuthoringCreateData;
}

type PortSpec = {readonly name: string; readonly type: 'data' | 'artifact'};

/**
 * Builds a constrained, generator-safe starter body. When the step declares an input the
 * signature also declares the matching parameter (with a JSON-safe default) so the input can
 * bind to a function argument. A return type annotation is always emitted: the generator
 * requires the source and signature to declare the same return annotation, so an unannotated
 * function cannot be lowered or saved. It is never parsed or executed in-browser.
 */
const starterHeader = (name: string, input: PortSpec | null): string =>
  input ? `def ${name}(${input.name}=None) -> dict:` : `def ${name}() -> dict:`;

const starterSignature = (name: string, input: PortSpec | null): string =>
  starterHeader(name, input);

const starterSource = (name: string, input: PortSpec | null): string =>
  input
    ? `${starterHeader(name, input)}\n    result = {"${input.name}": ${input.name}}\n    return result\n`
    : `${starterHeader(name, input)}\n    result = {}\n    return result\n`;

const preset = (
  taskType: string,
  id: string,
  label: string,
  description: string,
  name: string,
  input: PortSpec | null,
  output: PortSpec,
  keywords: readonly string[],
): ClearpipeFunctionAuthoringCatalogPreset => ({
  id,
  label,
  description,
  keywords: [taskType, 'function', 'code', ...keywords],
  create: {
    taskType,
    name,
    label,
    signature: starterSignature(name, input),
    source: starterSource(name, input),
    ...(input ? {inputs: [{id: `input_${input.name}`, name: input.name, type: input.type, required: false}]} : {}),
    outputs: [{id: 'output_result', name: output.name, type: output.type}],
  },
});

/**
 * One catalog capability per ClearML task type. Each opens the constrained function create
 * flow pre-filled with a relevant task type, name, signature, source, a typed input where the
 * step consumes upstream data, and a default output so adjacent steps connect right away.
 * Source/root steps (data processing, custom) declare no input.
 */
export const CLEARPIPE_FUNCTION_TASK_TYPE_PRESETS: readonly ClearpipeFunctionAuthoringCatalogPreset[] = [
  preset('data_processing', 'function-data-processing', 'Data processing step', 'Transform or prepare data for downstream steps.', 'data_processing_step', null, {name: 'dataset', type: 'data'}, ['data', 'preprocess', 'transform']),
  preset('training', 'function-training', 'Training step', 'Train a model as a code-backed pipeline step.', 'training_step', {name: 'dataset', type: 'data'}, {name: 'model', type: 'artifact'}, ['train', 'model', 'fit']),
  preset('testing', 'function-testing', 'Testing step', 'Evaluate a trained model or dataset.', 'testing_step', {name: 'model', type: 'artifact'}, {name: 'report', type: 'data'}, ['test', 'evaluate', 'metrics']),
  preset('inference', 'function-inference', 'Inference step', 'Run batch inference with a trained model.', 'inference_step', {name: 'model', type: 'artifact'}, {name: 'prediction', type: 'data'}, ['inference', 'predict', 'serve']),
  preset('qc', 'function-qc', 'Quality control step', 'Run quality-control checks on data or models.', 'qc_step', {name: 'data', type: 'data'}, {name: 'report', type: 'data'}, ['qc', 'quality', 'validate']),
  preset('application', 'function-application', 'Application step', 'Run an application task step.', 'application_step', {name: 'data', type: 'data'}, {name: 'result', type: 'data'}, ['application', 'app']),
  preset('monitor', 'function-monitor', 'Monitor step', 'Monitor pipeline or model behaviour.', 'monitor_step', {name: 'data', type: 'data'}, {name: 'result', type: 'data'}, ['monitor', 'observe']),
  preset('controller', 'function-controller', 'Controller step', 'Coordinate downstream pipeline steps.', 'controller_step', {name: 'data', type: 'data'}, {name: 'result', type: 'data'}, ['controller', 'orchestrate']),
  preset('optimizer', 'function-optimizer', 'Optimizer step', 'Run hyperparameter optimization.', 'optimizer_step', {name: 'dataset', type: 'data'}, {name: 'result', type: 'data'}, ['optimizer', 'hpo', 'tune']),
  preset('service', 'function-service', 'Service step', 'Run a long-running service task step.', 'service_step', {name: 'data', type: 'data'}, {name: 'result', type: 'data'}, ['service', 'daemon']),
  preset('custom', 'function-custom', 'Custom function step', 'Author a custom code-backed function step.', 'custom_step', null, {name: 'result', type: 'data'}, ['custom', 'generic']),
];
