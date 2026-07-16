import type { GenerationStatus } from '../db';

export type GenerationSummary = {
  id: string;
  sessionId: string;
  prompt: string;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
  jobs: Array<{
    id: string;
    provider: string;
    model: string;
    status: GenerationStatus;
    error: unknown | null;
  }>;
  images: Array<{
    id: string;
    jobId: string;
    url: string;
    width: number | null;
    height: number | null;
  }>;
};

export type GalleryItem = {
  favoriteId: string;
  imageId: string;
  url: string;
  width: number | null;
  height: number | null;
  favoritedAt: string;
  jobId: string;
  provider: string;
  model: string;
  generationId: string;
  prompt: string;
  sessionId: string;
  projectId: string;
  projectTitle: string;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};
