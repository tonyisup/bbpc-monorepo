import type { SegmentTemplate } from '@/types';

export const DEFAULT_SEGMENT_TEMPLATES: SegmentTemplate[] = [
  {
    id: 'seg-news',
    label: 'News',
    type: 'news',
    introSounder: 'Intros/Base.mp3',
  },
  {
    id: 'seg-game',
    label: 'Game of the Week',
    type: 'segment',
    introSounder: 'Soundboard/sob.mp3',
  },
  {
    id: 'seg-caller',
    label: 'Caller Interactions',
    type: 'interview',
  },
];
