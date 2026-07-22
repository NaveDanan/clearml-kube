import {clearpipeRoutes} from './clearpipe.routes';

describe('ClearPipe routes', () => {
  it('keeps new before the task-id editor route and protects dirty editors', () => {
    expect(clearpipeRoutes.map(route => route.path)).toEqual(['', 'new', ':taskId/edit', ':taskId']);
    expect(clearpipeRoutes[1].canDeactivate?.length).toBe(1);
    expect(clearpipeRoutes[2].canDeactivate?.length).toBe(1);
    expect(clearpipeRoutes[2].data).toEqual({clearpipeVisualEdit: true, existingPipeline: true});
    expect(clearpipeRoutes[3].canDeactivate?.length).toBe(1);
    expect(clearpipeRoutes[3].data).toEqual({existingPipeline: true});
  });
});
