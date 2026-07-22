/**
 * Canonical, persisted ClearPipe graph v2 contract.
 *
 * This module deliberately excludes canvas interaction, request state, runtime
 * task IDs, credentials, and generated source.  It is a typed projection of
 * apiserver/bll/clearpipe/graph_v2.py.
 */

export const GRAPH_V2_SCHEMA_VERSION = 2 as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface NodeVisual {
  position: Point;
  dimensions?: Dimensions;
}

export interface GraphVisual {
  viewport: Point;
  zoom: number;
}

export interface DocumentMetadata {
  id?: string;
  revision?: number;
  name: string;
  project: string;
  version?: string;
  description?: string;
  tags: string[];
}

export interface GraphSettings {
  default_execution_queue_id?: string;
}

export type ResourceKind = 'dataset' | 'model' | 'queue' | 'task';

/** An immutable ClearML resource ID with an optional stale-safe display label. */
export interface ResourceReference {
  id: string;
  kind: ResourceKind;
  resource_id: string;
  label?: string;
}

export interface PipelineParameter {
  id: string;
  name: string;
  required: boolean;
  order: number;
  default?: JsonValue;
  description?: string;
}

export type PortDirection = 'input' | 'output';
export type PortRole = 'data' | 'artifact' | 'parameter';
export type PortMultiplicity = 'single' | 'many';
export type BindingKind = 'data' | 'artifact' | 'parameter' | 'inferred' | 'execution-only';

export interface GraphPort {
  id: string;
  kind: 'port';
  name: string;
  direction: PortDirection;
  role: PortRole;
  required: boolean;
  multiplicity: PortMultiplicity;
  accepted_binding_kinds: BindingKind[];
  order: number;
  default?: JsonValue;
}

export interface TaskIdReference {
  kind: 'task-id';
  task_id: string;
}

export interface TaskNameReference {
  kind: 'task-name';
  project: string;
  name: string;
}

export type TaskReference = TaskIdReference | TaskNameReference;

export interface TaskConfiguration {
  clone_base_task?: boolean;
  cache?: boolean;
  queue_resource_id?: string;
}

export interface FunctionConfiguration {
  task_type: string;
  cache?: boolean;
  queue_resource_id?: string;
}

interface BaseNode {
  id: string;
  name: string;
  label: string;
  ports: GraphPort[];
  visual: NodeVisual;
}

export interface TaskNode extends BaseNode {
  kind: 'task';
  base_task: TaskReference;
  configuration: TaskConfiguration;
}

export interface FunctionNode extends BaseNode {
  kind: 'function';
  signature: string;
  source: string;
  configuration: FunctionConfiguration;
}

/** Only task and function nodes are executable in v2. */
export type GraphNode = TaskNode | FunctionNode;

export interface PortEndpoint {
  kind: 'port';
  node_id: string;
  port_id: string;
}

export interface ParameterEndpoint {
  kind: 'parameter';
  parameter_id: string;
}

export interface ResourceEndpoint {
  kind: 'resource';
  resource_id: string;
}

export interface NodeEndpoint {
  kind: 'node';
  node_id: string;
}

export interface DataBinding {
  id: string;
  kind: 'data';
  source: PortEndpoint;
  target: PortEndpoint;
}

export interface ArtifactBinding {
  id: string;
  kind: 'artifact';
  source: PortEndpoint | ResourceEndpoint;
  target: PortEndpoint;
}

export interface ParameterBinding {
  id: string;
  kind: 'parameter';
  source: ParameterEndpoint;
  target: PortEndpoint;
}

export interface InferredBinding {
  id: string;
  kind: 'inferred';
  source: NodeEndpoint;
  target: NodeEndpoint;
  derived_from: PortEndpoint;
}

export interface ExecutionOnlyBinding {
  id: string;
  kind: 'execution-only';
  source: NodeEndpoint;
  target: NodeEndpoint;
}

export type GraphBinding =
  | DataBinding
  | ArtifactBinding
  | ParameterBinding
  | InferredBinding
  | ExecutionOnlyBinding;

export interface GraphOutput {
  id: string;
  name: string;
  source: PortEndpoint;
}

/** A deduplicated execution dependency derived from node-to-node bindings. */
export interface GraphDependency {
  source_node_id: string;
  target_node_id: string;
}

export interface GraphV2 {
  schema_version: typeof GRAPH_V2_SCHEMA_VERSION;
  document: DocumentMetadata;
  settings: GraphSettings;
  parameters: PipelineParameter[];
  resources: ResourceReference[];
  outputs: GraphOutput[];
  nodes: GraphNode[];
  bindings: GraphBinding[];
  visual: GraphVisual;
}

export interface GraphCodecIssue {
  code: string;
  path: string;
  message: string;
}

export interface UnsupportedGraph {
  raw: JsonValue;
  reason: string;
  path: string;
  read_only: true;
}

export type GraphDecodeResult =
  | { status: 'ok'; graph: GraphV2 }
  | { status: 'invalid'; errors: GraphCodecIssue[] }
  | { status: 'unsupported'; unsupported: UnsupportedGraph };
