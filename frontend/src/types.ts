export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Issue {
  id: string;
  service: string;
  title: string;
  culprit: string | null;
  status: 'unresolved' | 'resolved' | 'ignored';
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  latest_level: string | null;
  recent_timestamps: string[];
}

export interface EventRecord {
  id: string;
  issue_id: string;
  service: string;
  environment: string;
  level: string;
  message: string;
  stacktrace: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  issue_title?: string | null;
  issue_status?: string | null;
}
