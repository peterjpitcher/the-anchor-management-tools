import { Icon, type IconName } from '@/ds';
import { cn } from '@/lib/utils';

interface DownloadLinkProps {
  href: string;
  children: React.ReactNode;
  icon?: IconName;
  disabled?: boolean;
  title?: string;
}

/**
 * A header action that downloads a file the server builds (the rota PDF, the hours report,
 * the payroll spreadsheet). It looks exactly like a small secondary LinkButton, but stays a
 * plain anchor with `download`: LinkButton renders next/link, which has no `download` and would
 * try to navigate client-side to a route that answers with a file.
 */
export function DownloadLink({ href, children, icon = 'download', disabled = false, title }: DownloadLinkProps): React.JSX.Element {
  return (
    <a
      href={href}
      download
      title={title}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        // The same classes as LinkButton variant="secondary" size="sm".
        'inline-flex items-center justify-center gap-1.5 border font-semibold transition-all no-underline',
        'max-shell:min-h-touch',
        'focus-visible:outline-hidden focus-visible:shadow-ring',
        'h-btn-h-sm px-2.5 text-xs rounded-sm',
        'bg-surface text-text border-border-strong hover:bg-surface-hover',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <span className="flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </a>
  );
}
