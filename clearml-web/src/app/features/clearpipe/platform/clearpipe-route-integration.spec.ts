import {routes} from '~/app.routes';
import {ClearpipeAdapterService} from './clearpipe-adapter.service';

describe('ClearPipe route integration', () => {
  it('redirects legacy visual entries before the existing pipelines route and guards their destination', () => {
    const children = routes[0].children!;
    const entryPaths = children
      .filter(route => route.data?.['clearpipeEntry'])
      .map(route => route.path);
    const firstPipelineRoute = children.findIndex(route => route.path === 'pipelines');
    const lastEntryRoute = children.findIndex(route => route.path === 'pipelines/clearpipe/:taskId/edit');

    expect(entryPaths).toEqual([
      'pipelines/clearpipe',
      'pipelines/clearpipe/new',
      'pipelines/clearpipe/:taskId/edit',
    ]);
    expect(lastEntryRoute).toBeLessThan(firstPipelineRoute);
    expect(children[firstPipelineRoute].loadChildren).toBeDefined();
    expect(children.filter(route => route.path === 'pipelines').length).toBe(2);
    children.filter(route => route.data?.['clearpipeEntry']).forEach(route => {
      expect(route.canMatch).toBeUndefined();
      expect(route.redirectTo).toContain('clearpipe');
    });
    expect(children.find(route => route.path === 'clearpipe')?.canMatch?.length).toBe(1);
  });

  it('keeps semantic route construction inside the platform adapter', () => {
    expect(ClearpipeAdapterService.prototype.routeFor).toBeDefined();
    expect(ClearpipeAdapterService.prototype.parseRoute).toBeDefined();
    expect(ClearpipeAdapterService.prototype.navigate).toBeDefined();
  });
});
