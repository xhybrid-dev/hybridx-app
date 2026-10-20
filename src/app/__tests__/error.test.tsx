import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import RootError from '@/app/error';

const render = (error: Error) => renderToStaticMarkup(<RootError error={error} reset={() => {}} />);

describe('root error boundary', () => {
  it('says it is updating, not that something broke, when the build has been replaced', () => {
    const stale = Object.assign(new Error('Loading chunk 6671 failed.'), { name: 'ChunkLoadError' });
    const html = render(stale);

    expect(html).toContain('Updating to the latest version');
    expect(html).not.toContain('Something went wrong');
  });

  it('still shows the error for anything else', () => {
    const html = render(new Error('Missing or insufficient permissions.'));

    expect(html).toContain('Something went wrong');
    expect(html).not.toContain('Updating to the latest version');
  });
});
