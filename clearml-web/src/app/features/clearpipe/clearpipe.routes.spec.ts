import {clearpipeRoutes} from './clearpipe.routes';

describe('ClearPipe routes', () => {
  it('keeps new before the task-id editor route and protects dirty editors', () => {
    expect(clearpipeRoutes.map(route => route.path)).toEqual(['', 'new', ':taskId']);
    expect(clearpipeRoutes[1].canDeactivate?.length).toBe(1);
    expect(clearpipeRoutes[2].canDeactivate?.length).toBe(1);
  });
});
