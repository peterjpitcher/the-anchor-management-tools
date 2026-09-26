import { Alert } from '@/ds';

interface PartialLoadAlertProps {
  /** What failed to load, in the words staff use ("staff list", "departments"). */
  missing: string[];
  /** What that means on this page, as the end of a sentence ("the rota below may be incomplete"). */
  consequence: string;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The danger alert a rota page shows when a secondary load fails but the page is still usable, so
 * a failed load never reads as an empty list or a default. Renders nothing when everything loaded.
 */
export function PartialLoadAlert({ missing, consequence }: PartialLoadAlertProps): React.JSX.Element | null {
  if (missing.length === 0) return null;

  return (
    <Alert tone="danger" title="Part of this page could not load">
      The {joinNames(missing)} could not be loaded, so {consequence}. Refresh the page to try again.
    </Alert>
  );
}
