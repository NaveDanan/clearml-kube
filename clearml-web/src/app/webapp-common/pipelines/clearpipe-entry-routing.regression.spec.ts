import {routes} from '~/app.routes';
import {
  clearpipeExistingPipelineEditRoute,
} from '../pipelines-controller/pipeline-controller-info/pipeline-controller-info.component';

describe('/pipelines ClearPipe entry-point regression', () => {
  const children = routes[0].children!;

  it('keeps legacy ClearPipe redirects ahead of the unchanged pipeline loader', () => {
    const pipelineLoader = children.findIndex(route => route.path === 'pipelines');
    const entries = children.filter(route => route.data?.['clearpipeEntry']);

    expect(entries.map(route => ({
      path: route.path,
      redirectTo: route.redirectTo,
      pathMatch: route.pathMatch,
    }))).toEqual([
      {path: 'pipelines/clearpipe', redirectTo: 'clearpipe', pathMatch: 'full'},
      {path: 'pipelines/clearpipe/new', redirectTo: 'clearpipe/new', pathMatch: 'full'},
      {path: 'pipelines/clearpipe/:taskId/edit', redirectTo: 'clearpipe/:taskId/edit', pathMatch: 'full'},
    ]);
    expect(entries.every(route => !route.canMatch && !route.canActivate)).toBeTrue();
    expect(children.findIndex(route => route.path === 'pipelines/clearpipe/:taskId/edit')).toBeLessThan(pipelineLoader);
    expect(children[pipelineLoader]).toEqual(jasmine.objectContaining({
      data: {search: true, autoSearchTab: 'pipelines'},
      loadChildren: jasmine.any(Function),
    }));
  });

  it('uses the controller identity rather than a selected DAG step when opening the visual editor', () => {
    const controllerId = 'pipeline-controller-0001';
    const selectedStepId = 'pipeline-step-0009';

    expect(clearpipeExistingPipelineEditRoute(controllerId)).toEqual(['/clearpipe', controllerId, 'edit']);
    expect(clearpipeExistingPipelineEditRoute(controllerId)).not.toContain(selectedStepId);
    expect(clearpipeExistingPipelineEditRoute(null)).toBeNull();
    expect(clearpipeExistingPipelineEditRoute('')).toBeNull();
  });

  it('leaves existing project-scoped pipeline navigation registered after ClearPipe redirects', () => {
    const projectPipelineRoute = children
      .find(route => route.path === 'pipelines' && Array.isArray(route.children));
    const projectIdRoute = projectPipelineRoute?.children?.find(route => route.path === ':projectId');

    expect(projectIdRoute?.children?.find(route => route.path === 'pipelines')).toEqual(jasmine.objectContaining({
      loadChildren: jasmine.any(Function),
    }));
    expect(projectIdRoute?.children?.find(route => route.path === 'tasks')).toEqual(jasmine.objectContaining({
      loadChildren: jasmine.any(Function),
    }));
  });
});
