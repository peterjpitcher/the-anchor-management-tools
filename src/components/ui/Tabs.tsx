'use client';

import { useState } from 'react';

interface Tab {
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab?: number;
  onTabChange?: (index: number) => void;
}

export function Tabs({ tabs, activeTab: controlledActiveTab, onTabChange }: TabsProps) {
  const [internalActiveTab, setInternalActiveTab] = useState(0);
  
  // Use controlled state if provided, otherwise use internal state
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const setActiveTab = (index: number) => {
    if (onTabChange) {
      onTabChange(index);
    } else {
      setInternalActiveTab(index);
    }
  };

  const tabNavigation = (
    <div className="border-b border-gray-200 relative">
      <nav className="-mb-px flex space-x-4 sm:space-x-8 px-4 sm:px-6 overflow-x-auto scrollbar-hide" aria-label="Tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(index)}
            className={`${
              index === activeTab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 active:text-gray-900'
            } whitespace-nowrap py-4 px-3 sm:py-3 sm:px-1 border-b-2 font-medium text-sm min-w-[80px] transition-colors`}
            aria-current={index === activeTab ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {/* Scroll indicators for mobile */}
      <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-white to-transparent pointer-events-none z-10 sm:hidden" />
      <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-white to-transparent pointer-events-none z-10 sm:hidden" />
    </div>
  );

  return (
    <div>
      {tabNavigation}
      <div className="px-4 py-4 sm:px-6">
        {tabs.length > 0 && tabs[activeTab].content}
      </div>
    </div>
  );
} 