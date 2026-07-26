import {clearpipeRoutes} from '../clearpipe.routes';
import {ClearpipeFlowEditorComponent} from '../editor/flow/clearpipe-flow-editor.component';

describe('existing pipeline routes', () => {
  it('loads only the new Flow editor for both supported existing-pipeline URLs', async () => {
    const routes = clearpipeRoutes.filter(route => route.path === ':taskId/edit' || route.path === ':taskId');

    expect(routes.length).toBe(2);
    expect(routes[0].data).toEqual({clearpipeVisualEdit: true, existingPipeline: true});
    expect(routes[1].data).toEqual({existingPipeline: true});
    expect(routes.every(route => route.canDeactivate?.length)).toBeTrue();
    const components = await Promise.all(routes.map(route => route.loadComponent!()));
    expect(components.every(component => component === ClearpipeFlowEditorComponent)).toBeTrue();
  });
});
