import type { GenerationStatus } from '../db';
import type { Project, Session } from '../db';
import type { JobView } from '../job-engine/types';
import type { ImageAvailability } from '../db';

export type ProjectSummary = {
  project: Project;
  sessionCount: number;
  generationCount: number;
  imageCount: number;
  lastActivityAt: string;
  coverImageUrl: string | null;
};

export type HistoryGroup = {
  session: Session;
  generationCount: number;
  imageCount: number;
  lastGenerationAt: string;
  items: GenerationSummary[];
  nextCursor: string | null;
};

export type HistoryPage = {
  projectId: string;
  page: number;
  pageSize: number;
  totalSessions: number;
  totalPages: number;
  totals: {
    generations: number;
    images: number;
  };
  groups: HistoryGroup[];
};

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
    error: JobView['error'] | null;
  }>;
  images: Array<{
    id: string;
    jobId: string;
    url: string | null;
    width: number | null;
    height: number | null;
    availability: ImageAvailability;
    removedAt: string | null;
  }>;
};

export type GalleryItem = {
  favoriteId: string;
  imageId: string;
  url: string | null;
  availability: ImageAvailability;
  removedAt: string | null;
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
