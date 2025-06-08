'use client';

import { useState } from 'react';

interface Tab {
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
}

export function Tabs({ tabs }: TabsProps) {
  const [activeTab, setActiveTab] = useState(0);

  const tabNavigation = (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex space-x-8 px-4 sm:px-6 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(index)}
            className={`${
              index === activeTab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm`}
            aria-current={index === activeTab ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <div>
      {/* Mobile view: Horizontally scrolling tabs */}
      <div className="sm:hidden">
        {tabNavigation}
        <div className="px-4 py-4">
          {tabs.length > 0 && tabs[activeTab].content}
        </div>
      </div>
      
      {/* Desktop view: Standard tabs */}
      <div className="hidden sm:block">
        {tabNavigation}
        <div className="px-4 py-4 sm:px-6">
          {tabs.length > 0 && tabs[activeTab].content}
        </div>
      </div>
    </div>
  );
} 