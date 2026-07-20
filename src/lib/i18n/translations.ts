import { commonEn, commonZhCN } from './messages/common';
import { dialogsEn, dialogsZhCN } from './messages/dialogs';
import { galleryEn, galleryZhCN } from './messages/gallery';
import { generateEn, generateZhCN } from './messages/generate';
import { historyEn, historyZhCN } from './messages/history';
import { homeEn, homeZhCN } from './messages/home';
import { modelsEn, modelsZhCN } from './messages/models';
import { providersEn, providersZhCN } from './messages/providers';

export const zhCN = {
  ...commonZhCN,
  ...homeZhCN,
  ...generateZhCN,
  ...historyZhCN,
  ...galleryZhCN,
  ...modelsZhCN,
  ...providersZhCN,
  ...dialogsZhCN,
} as const;

export type TranslationKey = keyof typeof zhCN;

export const en: Record<TranslationKey, string> = {
  ...commonEn,
  ...homeEn,
  ...generateEn,
  ...historyEn,
  ...galleryEn,
  ...modelsEn,
  ...providersEn,
  ...dialogsEn,
};
