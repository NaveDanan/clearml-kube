import {
  clearpipeExistingPipelineEditRoute,
} from '../../../webapp-common/pipelines-controller/pipeline-controller-info/pipeline-controller-info.component';

describe('existing pipeline entry route', () => {
  it('uses the controller definition ID when an ordinary DAG step is selected', () => {
    const controllerId = 'controller-definition-1';
    const selectedStep = {id: 'ordinary-step-task-9', stage: null};

    const route = clearpipeExistingPipelineEditRoute(controllerId);

    expect(selectedStep.id).not.toBe(controllerId);
    expect(route).toEqual(['/clearpipe', 'controller-definition-1', 'edit']);
    expect(route).not.toContain(selectedStep.id);
  });

  it('does not create an entry route until the controller route identity is available', () => {
    expect(clearpipeExistingPipelineEditRoute(null)).toBeNull();
  });
});
