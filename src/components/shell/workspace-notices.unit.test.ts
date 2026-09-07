import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_NOTICE_DURATION_MS,
  dismissWorkspaceNotice,
  prependWorkspaceNotice,
  type WorkspaceNotice,
} from './workspace-notices';

const first: WorkspaceNotice = {
  id: 'notice-1',
  variant: 'error',
  title: '保存失败',
};

describe('workspace notices', () => {
  it('uses one consistent three-second lifetime', () => {
    expect(WORKSPACE_NOTICE_DURATION_MS).toBe(3_000);
  });

  it('places new notices above earlier notices and dismisses only its target', () => {
    const notices = prependWorkspaceNotice([first], {
      id: 'notice-2',
      variant: 'success',
      title: '已保存',
    });

    expect(notices.map((notice) => notice.id)).toEqual(['notice-2', 'notice-1']);
    expect(dismissWorkspaceNotice(notices, 'notice-2')).toEqual([first]);
  });
});
