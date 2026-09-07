import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_NOTICE_DURATION_MS,
  dismissWorkspaceNotice,
  favoriteErrorNotice,
  favoriteSuccessNotice,
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

  it('builds consistent success and error payloads for favorite actions', () => {
    expect(favoriteSuccessNotice('已将图片加入收藏。')).toEqual({
      variant: 'success',
      title: '已将图片加入收藏。',
    });
    expect(favoriteErrorNotice('收藏状态更新失败，请重试。', '未能保存到应用。')).toEqual({
      variant: 'error',
      title: '收藏状态更新失败，请重试。',
      detail: '未能保存到应用。',
    });
  });
});
