import {clearpipeRoutes} from '../clearpipe.routes';

describe('existing pipeline routes', () => {
  it('loads existing pipeline review before the editor for both supported entry URLs', async () => {
    const routes = clearpipeRoutes.filter(route => route.path === ':taskId/edit' || route.path === ':taskId');

    expect(routes.length).toBe(2);
    expect(routes.every(route => route.data?.['existingPipeline'])).toBeTrue();
    expect(routes.every(route => route.canDeactivate?.length)).toBeTrue();
    const component = await routes[0].loadComponent!();
    expect(component).toBeDefined();
  });
});
