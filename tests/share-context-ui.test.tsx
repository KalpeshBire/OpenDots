import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, describe, vi } from 'vitest';

vi.mock('../src/client/api.js', () => ({
  api: vi.fn(),
  setToken: vi.fn(),
}));

import { ShareContextModal } from '../src/client/ShareContextModal.js';
import { SharedContextImportView } from '../src/client/SharedContextImportView.js';
import type { Conversation, Dot } from '../src/shared/types.js';

const mockDot: Dot = {
  id: 'dot-1',
  spaceId: 'space-1',
  spaceIds: ['space-1'],
  name: 'CodeDot',
  instructions: 'Software engineering assistant',
  researchAllowed: true,
  memoryAllowed: true,
  appsAllowed: false,
  composioToolkits: [],
  createdAt: Date.now(),
};

const mockThread: Conversation = {
  id: 'thread-123',
  dotId: 'dot-1',
  ownerId: 'owner-1',
  title: 'Refactoring Architecture',
  createdAt: Date.now(),
};

describe('Share Context UI Components', () => {
  it('renders complete Share Context Modal with all options and destinations', () => {
    const html = renderToStaticMarkup(
      <ShareContextModal
        thread={mockThread}
        dot={mockDot}
        onClose={() => {}}
      />
    );

    // Modal structure & header
    expect(html).toContain('Share Context');
    expect(html).toContain('Transfer this conversation to another AI without explaining everything again.');

    // Modes
    expect(html).toContain('Smart Context');
    expect(html).toContain('Entire Conversation');
    expect(html).toContain('Custom Context');

    // Destinations
    expect(html).toContain('Universal Context (JSON / Markdown)');
    expect(html).toContain('ChatGPT (OpenAI)');
    expect(html).toContain('Claude (Anthropic)');
    expect(html).toContain('Google Gemini');

    // Controls
    expect(html).toContain('Security &amp; Link Expiration');
    expect(html).toContain('Allow one-time use only');
    expect(html).toContain('Expires in 24 hours');
    expect(html).toContain('Cancel');
  });

  it('renders SharedContextImportView loading state initially', () => {
    const html = renderToStaticMarkup(
      <SharedContextImportView
        token="sample-public-token"
        dots={[mockDot]}
        onImported={() => {}}
        onCancel={() => {}}
      />
    );

    expect(html).toContain('Verifying and retrieving shared context...');
    expect(html).toContain('import-loading-state');
  });
});
