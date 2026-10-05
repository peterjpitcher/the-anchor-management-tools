import { Alert, Badge, Card, Section } from '@/ds';
import { formatDateInLondon } from '@/lib/dateUtils';
import type { StaffCalendarNote } from '@/lib/portal/staff-calendar-notes';

interface StaffNotesSectionProps {
  notes: StaffCalendarNote[];
  /** True when the notes could not be read, so staff are told rather than shown nothing. */
  failed: boolean;
  /** Today in London, YYYY-MM-DD. */
  today: string;
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

function formatNoteDates(note: StaffCalendarNote): string {
  const start = formatDateInLondon(note.startDate, DAY_FORMAT);
  if (note.endDate === note.startDate) return start;
  return `${start} to ${formatDateInLondon(note.endDate, DAY_FORMAT)}`;
}

/**
 * Venue calendar notes a manager has ticked "Show to staff": owners away, kitchen closed, clock
 * changes and the like. Title and dates only. Renders nothing when there is nothing to show,
 * so a quiet month does not leave an empty box above the shifts.
 */
export default function StaffNotesSection({ notes, failed, today }: StaffNotesSectionProps) {
  if (failed) {
    return (
      <Section title="Dates to Know">
        <Alert tone="danger">Dates to know could not be loaded. Refresh the page to try again.</Alert>
      </Section>
    );
  }

  if (notes.length === 0) return null;

  return (
    <Section title="Dates to Know" description="Coming up at the pub, added by your manager.">
      <Card padding="none">
        <ul className="divide-y divide-border">
          {notes.map(note => {
            const isOnNow = note.startDate <= today && note.endDate >= today;
            return (
              <li key={note.id} className="px-pad-card py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{note.title}</p>
                    <p className="mt-1 text-xs text-text-muted">{formatNoteDates(note)}</p>
                  </div>
                  {isOnNow ? (
                    <Badge tone="primary" size="sm">
                      {note.endDate === note.startDate ? 'Today' : 'On now'}
                    </Badge>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}
