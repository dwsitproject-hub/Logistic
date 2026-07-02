export type UserActivityEventType = 'CLICK' | 'CREATE' | 'UPDATE' | 'EDIT' | 'VIEW';

export type UserActivityEventPayload = {
  eventType: UserActivityEventType;
  pagePath?: string;
  actionLabel?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  eventAt?: string;
};

export type DailyActivitySummary = {
  user_id: string;
  username: string;
  full_name: string;
  role: string;
  activity_date: string;
  total_count: number;
  click_count: number;
  create_count: number;
  update_count: number;
  edit_count: number;
  view_count: number;
  active_seconds: number;
  active_duration_label: string;
};

export type ActivityDetailEvent = {
  id: string;
  event_type: string;
  page_path: string | null;
  action_label: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  event_at: string;
};

export const USER_ACTIVITY_IDLE_MINUTES = 10;

export function eventTypeLabel(type: string): string {
  switch (type) {
    case 'CLICK':
      return 'Button click';
    case 'CREATE':
      return 'Add information';
    case 'UPDATE':
      return 'Update information';
    case 'EDIT':
      return 'Edit information';
    case 'VIEW':
      return 'Page view';
    default:
      return type;
  }
}
