'use client';

import React from 'react';

interface ListItemProps {
  title: string;
  subtitle?: string;
  description?: string;
  actions?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const ListItem: React.FC<ListItemProps> = ({ 
  title,
  subtitle,
  description,
  actions,
  onClick,
  href,
  icon,
  badge,
  className = '',
  children
}) => {
  const Component = href ? 'a' : onClick ? 'button' : 'div';
  
  const baseStyles = 'block w-full bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors';
  const interactiveStyles = (href || onClick) ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2' : '';
  
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1">
          {icon && (
            <div className="flex-shrink-0 mt-0.5">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-gray-900 truncate">
                {title}
              </h3>
              {badge && badge}
            </div>
            {subtitle && (
              <p className="text-sm text-gray-500 mt-1">
                {subtitle}
              </p>
            )}
            {description && (
              <p className="text-sm text-gray-600 mt-2">
                {description}
              </p>
            )}
            {children && (
              <div className="mt-2">
                {children}
              </div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
            {actions}
          </div>
        )}
      </div>
    </>
  );
  
  if (Component === 'a') {
    return (
      <a
        href={href}
        className={`${baseStyles} ${interactiveStyles} ${className}`}
      >
        {content}
      </a>
    );
  }
  
  if (Component === 'button') {
    return (
      <button
        onClick={onClick}
        type="button"
        className={`${baseStyles} ${interactiveStyles} text-left ${className}`}
      >
        {content}
      </button>
    );
  }
  
  return (
    <div className={`${baseStyles} ${className}`}>
      {content}
    </div>
  );
};

ListItem.displayName = 'ListItem';

export { ListItem };
export type { ListItemProps };